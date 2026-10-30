// 📦 一鍵備份全部聊天（v0.13.37，使用者要求：以前要一個聊天一個聊天導出）。
//
// 範圍：這個角色的全部聊天，或所有角色的全部聊天。不打開聊天，直接向酒館要聊天檔來讀（和舊聊天整理一樣），
//   只取戀人手帳的資料（每層的摘要、聊天資料），每個聊天的格式和「資料管理 › 導出」一樣（backup.js）。
//   現在開著的聊天用記憶體裡最新的。沒有戀人手帳資料的聊天不放。
// 檔案：{ format: 'lovers-planner-bundle', version, exportedAt, scope, chats: [{ avatar, character, chat, data }],
//   characters: { [頭像]: 共用的記事、你的偏好、記憶範圍 }, settings? }（設定不含 API 金鑰）。
// 導入：現在開著的聊天馬上放回；其他聊天先記在這個瀏覽器裡，等打開那個聊天時才放回（不在背景改聊天檔，比較安全）。
//   放回之前一樣先自動備份一份（autobackup.js 的 r 格）。

import { ctx, LOG_PREFIX, MODULE, toast } from './util.js';
import { getSettings, saveSettings } from './settings.js';
import { t } from './i18n.js';
import { characterKey, currentChatId } from './scope.js';
import { chatKey, isAiMessage } from './chat.js';
import { applySettings, BACKUP_FORMAT, BACKUP_VERSION, backupFileName, buildBackup, importBackup, withoutSecrets } from './backup.js';
import { backupKey, backupNow, browserStore, characterPart, markIntentional, onChatReady, restoreCharacterPart } from './autobackup.js';

export const BUNDLE_FORMAT = 'lovers-planner-bundle';
const PENDING_KEY = 'pending-imports';

function headers() {
    return { ...(ctx()?.getRequestHeaders?.() ?? { 'Content-Type': 'application/json' }) };
}

async function post(url, body) {
    const res = await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

/** 從聊天檔（整個陣列）取出戀人手帳的資料，格式和 buildBackup 一樣。沒有資料回傳 null。 */
export function backupFromFile(file, { chat, character }) {
    const header = file[0] && !('mes' in file[0]) ? file[0] : null;
    const messages = header ? file.slice(1) : file;
    const floors = [];
    messages.forEach((m, i) => {
        const entry = m?.extra?.[MODULE];
        if (!entry || !isAiMessage(m)) return;
        floors.push({ sendDate: m.send_date ?? null, index: i, name: m.name ?? '', entry });
    });
    const meta = header?.chat_metadata?.[MODULE] ?? {};
    if (!floors.length && !Object.keys(meta).length) return null;
    return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), chat, character, floors, meta };
}

/**
 * 打包。scope：'character'（這個角色）| 'all'（所有角色）。onProgress({ k, n, character, chat })。
 * 回傳 { data, chats, characters, failed: [{ character, chat, error }] }。
 */
export async function buildBundle({ scope = 'character', settings = false, onProgress = () => {} } = {}) {
    const c = ctx();
    const all = (c?.characters ?? []).filter((x) => x?.avatar);
    const me = characterKey();
    const list = scope === 'all' ? all : all.filter((x) => x.avatar === me);
    const current = chatKey();
    const chats = [];
    const failed = [];
    const jobs = [];
    for (const ch of list) {
        try {
            const files = await post('/api/characters/chats', { avatar_url: ch.avatar });
            for (const f of Array.isArray(files) ? files : []) {
                const id = String(f.file_id ?? String(f.file_name ?? '').replace(/\.jsonl$/, ''));
                if (id) jobs.push({ ch, id });
            }
        } catch (e) {
            failed.push({ character: ch.name, chat: '', error: e?.message || String(e) });
        }
    }
    for (const [k, { ch, id }] of jobs.entries()) {
        onProgress({ k: k + 1, n: jobs.length, character: ch.name, chat: id });
        try {
            let data;
            if (ch.avatar === me && id === current) data = buildBackup({ settings: false });
            else {
                const file = await post('/api/chats/get', { ch_name: ch.name, file_name: id, avatar_url: ch.avatar });
                data = Array.isArray(file) ? backupFromFile(file, { chat: id, character: ch.name }) : null;
            }
            if (data && (data.floors.length || Object.keys(data.meta ?? {}).length)) chats.push({ avatar: ch.avatar, character: ch.name, chat: id, data });
        } catch (e) {
            console.warn(LOG_PREFIX, '打包時讀不到聊天', ch.name, id, e);
            failed.push({ character: ch.name, chat: id, error: e?.message || String(e) });
        }
    }
    const characters = {};
    for (const ch of list) {
        const part = characterPart(ch.avatar, { snapshots: true });
        if (part) characters[ch.avatar] = part;
    }
    const data = {
        format: BUNDLE_FORMAT, version: 1, exportedAt: new Date().toISOString(), scope,
        character: scope === 'all' ? 'all' : (list[0]?.name ?? ''), chats, characters,
        ...(settings ? { settings: withoutSecrets(getSettings()) } : {}),
    };
    return { data, chats: chats.length, characters: new Set(chats.map((x) => x.avatar)).size, failed };
}

export function bundleFileName(data) {
    return backupFileName({ ...data, character: data.scope === 'all' ? 'all' : data.character }).replace('lovers-planner_', 'lovers-planner-all_');
}

export function downloadBundle(data) {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = bundleFileName(data);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return a.download;
}

export function isBundle(data) {
    return data?.format === BUNDLE_FORMAT && Array.isArray(data.chats);
}

// ===== 導入 =====

async function pendingList() {
    try {
        const v = await browserStore('get', PENDING_KEY);
        return Array.isArray(v) ? v : [];
    } catch (e) {
        return [];
    }
}

async function savePending(list) {
    await browserStore('put', PENDING_KEY, list);
}

/** 還在等著放回的聊天有幾個。 */
export async function pendingCount() {
    return (await pendingList()).length;
}

// ===== 搬到別的酒館（v0.13.52，使用者要求：從 TauriTavern 搬一個角色到 SillyTavern） =====
// 酒館導入角色卡時頭像檔名可能不一樣，導入聊天時會換檔名（「… imported」）。
// 角色卡：同一個頭像檔名找不到，就找同名的角色（只有一個時）。
// 聊天：同一個 id 找不到，就讀這個角色的聊天，比 AI 樓層的 send_date，大部分對得上的就是同一個聊天；
//   記下改名（characters[頭像].renamed），「即時共用」的來源、日記記的聊天都會換成新的名字。

/** 打包檔裡的頭像 → 這邊的頭像（找不到回傳 null）。 */
function localAvatar(avatar, name) {
    const list = (ctx()?.characters ?? []).filter((x) => x?.avatar);
    if (list.some((x) => x.avatar === avatar)) return avatar;
    const same = list.filter((x) => x.name === name);
    return same.length === 1 ? same[0].avatar : null;
}

/** 一個聊天檔裡 AI 樓層的 send_date。 */
function aiDates(file) {
    const header = file[0] && !('mes' in file[0]) ? file[0] : null;
    return new Set((header ? file.slice(1) : file).filter((m) => isAiMessage(m) && m.send_date).map((m) => String(m.send_date)));
}

/**
 * 打包檔裡的聊天 → 這邊的聊天 id。chats：同一個角色的 [{ chat, data }]。
 * 回傳 Map(舊 id → 新 id)；對不上的不放。
 */
async function matchChats(avatar, name, chats) {
    const out = new Map();
    let files = [];
    try {
        const list = await post('/api/characters/chats', { avatar_url: avatar });
        files = (Array.isArray(list) ? list : []).map((f) => String(f.file_id ?? String(f.file_name ?? '').replace(/\.jsonl$/, ''))).filter(Boolean);
    } catch (e) {
        console.warn(LOG_PREFIX, '讀不到聊天清單', e);
        return out;
    }
    const left = [];
    for (const x of chats) {
        if (files.includes(x.chat)) out.set(x.chat, x.chat);
        else left.push(x);
    }
    const free = files.filter((id) => ![...out.values()].includes(id));
    if (!left.length || !free.length) return out;
    // 讀還沒對上的聊天，比 send_date。
    const dates = new Map();
    for (const id of free) {
        try {
            const file = await post('/api/chats/get', { ch_name: name, file_name: id, avatar_url: avatar });
            if (Array.isArray(file)) dates.set(id, aiDates(file));
        } catch (e) {
            console.warn(LOG_PREFIX, '讀不到聊天', id, e);
        }
    }
    for (const x of left) {
        const mine = (x.data?.floors ?? []).map((f) => String(f.sendDate ?? '')).filter(Boolean);
        if (!mine.length) continue;
        let best = null;
        let bestHit = 0;
        for (const [id, set] of dates) {
            if ([...out.values()].includes(id)) continue;
            const hit = mine.filter((d) => set.has(d)).length;
            if (hit > bestHit) {
                best = id;
                bestHit = hit;
            }
        }
        if (best && bestHit >= Math.max(1, Math.ceil(mine.length * 0.5))) out.set(x.chat, best);
    }
    return out;
}

/**
 * 導入打包檔。mode 和單一聊天的導入一樣（merge／replace）。
 * 回傳 { now: 現在這個聊天的 importBackup 結果或 null, later: 等打開時才放回的聊天數,
 *   renamed: 認出改過名的聊天數, moved: 角色卡換了頭像檔名的角色數 }。
 */
export async function importBundle(data, { mode = 'merge', settings = false } = {}) {
    const me = characterKey();
    const current = chatKey();
    let now = null;
    const later = [];
    // 打包檔的頭像 → 這邊的頭像；每個角色的聊天改名。
    const avatars = new Map();
    const renames = new Map();
    const byAvatar = new Map();
    for (const x of data.chats) {
        if (!byAvatar.has(x.avatar)) byAvatar.set(x.avatar, []);
        byAvatar.get(x.avatar).push(x);
    }
    const names = new Map([...data.chats.map((x) => [x.avatar, x.character])]);
    for (const avatar of new Set([...byAvatar.keys(), ...Object.keys(data.characters ?? {})])) {
        const local = localAvatar(avatar, names.get(avatar) ?? '') ?? avatar;
        avatars.set(avatar, local);
        if (byAvatar.has(avatar) && (ctx()?.characters ?? []).some((x) => x?.avatar === local)) {
            renames.set(avatar, await matchChats(local, (ctx()?.characters ?? []).find((x) => x.avatar === local)?.name ?? names.get(avatar) ?? '', byAvatar.get(avatar)));
        }
    }
    for (const x of data.chats) {
        const avatar = avatars.get(x.avatar) ?? x.avatar;
        const chat = renames.get(x.avatar)?.get(x.chat) ?? x.chat;
        if (avatar === me && (chat === current || currentChatId(x.chat, me) === current)) {
            await backupNow('before');
            now = importBackup(x.data, { mode, settings: false });
            markIntentional();
        } else later.push({ avatar, chat, character: x.character, mode, data: x.data, at: Date.now() });
    }
    let renamed = 0;
    for (const avatar of avatars.keys()) {
        const rename = Object.fromEntries([...(renames.get(avatar) ?? new Map())].filter(([a, b]) => a !== b));
        renamed += Object.keys(rename).length;
        const part = data.characters?.[avatar] ?? (Object.keys(rename).length ? {} : null);
        if (part) restoreCharacterPart(part, avatars.get(avatar), rename);
    }
    const moved = [...avatars].filter(([a, b]) => a !== b).length;
    if (settings && data.settings) applySettings(data.settings);
    saveSettings();
    if (later.length) {
        const keep = (await pendingList()).filter((p) => !later.some((l) => l.avatar === p.avatar && l.chat === p.chat));
        await savePending([...keep, ...later]);
    }
    return { now, later: later.length, renamed, moved };
}

/** 打開聊天時：有等著放回的就放回（先備份一份）。 */
export async function applyPending() {
    const key = backupKey();
    if (!key) return null;
    const me = characterKey();
    const current = chatKey();
    const list = await pendingList();
    const hit = list.find((p) => p.avatar === me && p.chat === current);
    if (!hit) return null;
    await backupNow('before');
    if (backupKey() !== key) return null;
    const r = importBackup(hit.data, { mode: hit.mode ?? 'merge', settings: false });
    markIntentional();
    await savePending(list.filter((p) => p !== hit));
    toast(t('bundle.applied', r), 'success');
    return r;
}

export function initBundle() {
    onChatReady(applyPending);
}
