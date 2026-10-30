// 🛟 自動備份＋防失憶警報（v0.13.37，使用者要求：以前用的記憶插件，一個月後摘要全被清空了）。
//
// 備份的內容和「資料管理 › 導出」一樣（backup.js 的 buildBackup：每層的摘要、聊天資料），另外附上角色卡自己的資料裡
// 屬於這個角色的部分（共用的記事、你的偏好、記憶範圍），不含設定和 API 金鑰。
// 什麼時候備份（settings.backup）：每天第一次打開這個聊天時（everyDays 天一次，0＝不看天數）、
//   摘要比上一份多 everyFloors 層時（0＝不看層數）。每個聊天留最近 keep 份，舊的輪流蓋掉。
// 存哪裡：酒館自己的資料夾（/api/files/upload，存在 user/files，換瀏覽器、清快取都在）；
//   存不了（例如宿主不支援）就存在這個瀏覽器裡（IndexedDB），畫面上會寫存在哪。
// 檔名：lp-bk_<角色和聊天的代碼>_<格子>.json；格子 0～keep-1 輪流用，r 是「放回之前」那份（不佔格子，不會擠掉好的備份）。
// 索引：settings.backupIndex[角色|聊天] = { list: [{ slot, at, reason, floors, digests, diary, total, size, where }], dismissed }。
//
// 防失憶警報：打開聊天時，摘要比最新一份備份少了一半以上（而且備份裡至少有 10 層），就跳警報，按一下放回去。
//   警報沒處理之前不自動備份（不然壞掉的樣子會把好的備份擠掉）。使用者自己刪的（資料管理 › 刪除、導入）不算。

import { ctx, LOG_PREFIX, MODULE, toast, toastActions } from './util.js';
import { getSettings, saveSettings } from './settings.js';
import { t } from './i18n.js';
import { characterKey } from './scope.js';
import { chatKey, getChat, hashText, isAiMessage } from './chat.js';
import { buildBackup, importBackup, parseBackup } from './backup.js';
import { isActive, onSummaryChange } from './summarize.js';
import { logError } from './errlog.js';

const OPEN_DELAY_MS = 6000;
const FLOOR_DELAY_MS = 20000;
const DAY_MS = 86400000;
/** 警報：備份裡至少有幾份資料，現在少於幾成才算「不見了」。 */
const ALARM_MIN = 10;
const ALARM_RATIO = 0.5;
const BEFORE_SLOT = 'r';

const listeners = new Set();
export function onBackupChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
function emit() {
    for (const fn of listeners) {
        try { fn(); } catch (e) { console.error(LOG_PREFIX, e); }
    }
}

let alarm = null;
let busy = false;
let lastError = '';
/** 這次開啟中，酒館的資料夾存不了：之後都直接存瀏覽器。 */
let tavernBroken = false;

// ===== 索引 =====

export function backupKey() {
    const chat = chatKey();
    return chat ? `${characterKey() ?? '-'}|${chat}` : null;
}

function indexOf(key = backupKey(), create = false) {
    if (!key) return null;
    const all = getSettings().backupIndex;
    if (!all[key] && create) all[key] = { list: [] };
    return all[key] ?? null;
}

/** 這個聊天的備份，新的在前。 */
export function listBackups(key = backupKey()) {
    return [...(indexOf(key)?.list ?? [])].sort((a, b) => b.at - a.at);
}

function fileName(key, slot) {
    return `lp-bk_${hashText(key)}${hashText(`${key}#`).slice(0, 4)}_${slot}.json`;
}

// ===== 現在有多少資料 =====

/** 摘要了幾層、幾個章卷、幾天日記；total 是三個加起來（警報用）。 */
export function backupMetrics() {
    const chat = getChat();
    let floors = 0;
    for (const m of chat) if (isAiMessage(m) && m.extra?.[MODULE]?.status === 'ok') floors++;
    const meta = ctx()?.chatMetadata?.[MODULE] ?? {};
    const digests = (meta.chapters?.length ?? 0) + (meta.volumes?.length ?? 0);
    const diary = Object.keys(meta.diary?.days ?? {}).length;
    return { floors, digests, diary, total: floors + digests + diary };
}

// ===== 存、讀 =====

function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}

function headers() {
    return { ...(ctx()?.getRequestHeaders?.() ?? { 'Content-Type': 'application/json' }) };
}

async function tavernSave(name, text) {
    const res = await fetch('/api/files/upload', { method: 'POST', headers: headers(), body: JSON.stringify({ name, data: toBase64(text) }) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function tavernLoad(name) {
    const res = await fetch(`/user/files/${name}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
}

function tavernDelete(name) {
    return fetch('/api/files/delete', { method: 'POST', headers: headers(), body: JSON.stringify({ path: `user/files/${name}` }) }).catch(() => {});
}

let dbPromise = null;
function db() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
        try {
            const req = globalThis.indexedDB?.open('lovers_planner_backups', 1);
            if (!req) return resolve(null);
            req.onupgradeneeded = () => req.result.createObjectStore('files');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
            req.onblocked = () => resolve(null);
        } catch (e) {
            resolve(null);
        }
    });
    return dbPromise;
}

/** IndexedDB：op 'get' | 'put' | 'delete'。 */
export async function browserStore(op, key, value) {
    const d = await db();
    if (!d) throw new Error('no IndexedDB');
    return new Promise((resolve, reject) => {
        const tx = d.transaction('files', op === 'get' ? 'readonly' : 'readwrite');
        const store = tx.objectStore('files');
        const req = op === 'get' ? store.get(key) : op === 'put' ? store.put(value, key) : store.delete(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/** 存一個檔：先試酒館的資料夾，不行就存瀏覽器。回傳 'tavern' | 'browser'。 */
async function store(name, text) {
    if (!tavernBroken) {
        try {
            await tavernSave(name, text);
            return 'tavern';
        } catch (e) {
            console.warn(LOG_PREFIX, '備份存不進酒館的資料夾，改存在瀏覽器', e);
            tavernBroken = true;
        }
    }
    await browserStore('put', name, text);
    return 'browser';
}

async function load(entry, key) {
    const name = fileName(key, entry.slot);
    const text = entry.where === 'browser' ? await browserStore('get', name) : await tavernLoad(name);
    if (typeof text !== 'string') throw new Error('missing');
    const r = parseBackup(text);
    if (r.error) throw new Error(r.error);
    return r.data;
}

// ===== 備份 =====

/** 角色卡自己的資料裡屬於這個角色、也該備份的部分（不含其他聊天的快照）。 */
export function characterPart(avatar = characterKey()) {
    const rec = getSettings().characters?.[avatar];
    if (!rec) return null;
    const out = {};
    for (const k of ['shared', 'prefs', 'prefsRemoved', 'scope']) if (rec[k] !== undefined) out[k] = JSON.parse(JSON.stringify(rec[k]));
    return Object.keys(out).length ? out : null;
}

/** 放回角色卡的資料：只補沒有的（共用的記事照 id、偏好照內容），不蓋掉現在的。 */
export function restoreCharacterPart(part, key = characterKey()) {
    if (!part || !key) return;
    const all = getSettings().characters;
    const rec = all[key] ?? (all[key] = {});
    if (part.scope && !rec.scope) rec.scope = part.scope;
    if (part.shared?.notes) {
        rec.shared ??= { notes: {} };
        rec.shared.notes ??= {};
        for (const [id, n] of Object.entries(part.shared.notes)) if (!rec.shared.notes[id]) rec.shared.notes[id] = n;
    }
    if (Array.isArray(part.prefs)) {
        rec.prefs = Array.isArray(rec.prefs) ? rec.prefs : [];
        const have = new Set(rec.prefs.map((p) => p.text));
        for (const p of part.prefs) if (p?.text && !have.has(p.text)) rec.prefs.push(p);
    }
    if (Array.isArray(part.prefsRemoved)) rec.prefsRemoved = [...new Set([...(rec.prefsRemoved ?? []), ...part.prefsRemoved])];
}

/**
 * 現在就備份一份。reason：'day' | 'floors' | 'manual' | 'before'（放回、導入之前；存在 r 格，不擠掉其他的）。
 * 回傳這一份的記錄；沒資料、沒聊天時回傳 null。
 */
export async function backupNow(reason = 'manual') {
    const key = backupKey();
    if (!key || !isActive()) return null;
    const m = backupMetrics();
    if (!m.total && reason !== 'before') return null;
    busy = true;
    emit();
    try {
        const data = { ...buildBackup({ settings: false }), characterPart: characterPart(), metrics: m };
        const text = JSON.stringify(data);
        const idx = indexOf(key, true);
        const keep = Math.max(1, Math.floor(Number(getSettings().backup?.keep) || 7));
        let slot = BEFORE_SLOT;
        if (reason !== 'before') {
            const used = idx.list.filter((e) => e.slot !== BEFORE_SLOT);
            const free = [...Array(keep).keys()].find((k) => !used.some((e) => e.slot === k));
            slot = free ?? used.sort((a, b) => a.at - b.at)[0].slot;
        }
        const where = await store(fileName(key, slot), text);
        if (backupKey() !== key) return null;
        const entry = { slot, at: Date.now(), reason, ...m, size: text.length, where };
        idx.list = [...idx.list.filter((e) => e.slot !== slot), entry];
        prune(key, keep);
        lastError = '';
        saveSettings();
        return entry;
    } catch (e) {
        console.warn(LOG_PREFIX, '備份失敗', e);
        logError('backup', e);
        lastError = e?.message || String(e);
        return null;
    } finally {
        busy = false;
        emit();
    }
}

/** 留的份數改小了：多的（最舊的）刪掉。 */
function prune(key, keep) {
    const idx = indexOf(key);
    const normal = (idx?.list ?? []).filter((e) => e.slot !== BEFORE_SLOT).sort((a, b) => b.at - a.at);
    for (const e of normal.slice(keep)) {
        const name = fileName(key, e.slot);
        if (e.where === 'browser') browserStore('delete', name).catch(() => {});
        else tavernDelete(name);
        idx.list = idx.list.filter((x) => x !== e);
    }
}

/** 照設定看要不要備份（打開聊天時、摘要變多時）。 */
export async function maybeBackup(trigger) {
    const s = getSettings().backup ?? {};
    if (!s.auto || busy || alarm || !isActive()) return null;
    const m = backupMetrics();
    if (!m.total) return null;
    const last = listBackups().find((e) => e.slot !== BEFORE_SLOT);
    if (!last) return backupNow(trigger === 'floors' ? 'floors' : 'day');
    const days = Number(s.everyDays) || 0;
    if (days > 0 && Date.now() - last.at >= days * DAY_MS) return backupNow('day');
    const floors = Number(s.everyFloors) || 0;
    if (floors > 0 && m.floors - (last.floors ?? 0) >= floors) return backupNow('floors');
    return null;
}

// ===== 防失憶警報 =====

/** 目前的警報：{ backup, now } 或 null。 */
export function backupAlarm() {
    return alarm;
}

export function checkAlarm() {
    alarm = null;
    if (getSettings().backup?.alarm === false || !isActive()) return null;
    const idx = indexOf();
    const latest = listBackups().find((e) => e.slot !== BEFORE_SLOT);
    if (!latest || (latest.total ?? 0) < ALARM_MIN || idx?.dismissed === latest.at) return null;
    const now = backupMetrics();
    if (now.total >= latest.total * ALARM_RATIO) return null;
    alarm = { backup: latest, now };
    emit();
    return alarm;
}

/** 使用者說「是我自己刪的」：這一份不再比，之後照常自動備份。 */
export function dismissAlarm() {
    const latest = listBackups().find((e) => e.slot !== BEFORE_SLOT);
    const idx = indexOf(backupKey(), true);
    if (latest && idx) idx.dismissed = latest.at;
    alarm = null;
    saveSettings();
    emit();
}

/** 自己刪、自己導入的（資料管理）：不算失憶。 */
export function markIntentional() {
    dismissAlarm();
}

// ===== 放回 =====

/** 放回某一份（slot）。先把現在的樣子存在 r 格，選錯了可以換回來。回傳 importBackup 的結果。 */
export async function restoreBackup(slot) {
    const key = backupKey();
    const entry = listBackups(key).find((e) => String(e.slot) === String(slot));
    if (!entry) throw new Error('missing');
    const data = await load(entry, key);
    if (backupKey() !== key) throw new Error('chat changed');
    // 放回 r 格那份時，不能先把它蓋掉。
    if (String(slot) !== BEFORE_SLOT) await backupNow('before');
    const r = importBackup(data, { mode: 'replace' });
    restoreCharacterPart(data.characterPart);
    alarm = null;
    const idx = indexOf(key, true);
    idx.dismissed = listBackups(key).find((e) => e.slot !== BEFORE_SLOT)?.at ?? null;
    saveSettings();
    emit();
    return r;
}

export function backupStatus() {
    const list = listBackups();
    return { busy, error: lastError, where: list[0]?.where ?? (tavernBroken ? 'browser' : ''), count: list.length };
}

// ===== 啟動 =====

let openTimer = null;
let floorTimer = null;
let openHooks = [];

/** 打開聊天後（延遲一下）要做的事，例如放回導入的備份（bundle.js）。在檢查警報之前跑。 */
export function onChatReady(fn) {
    openHooks.push(fn);
}

async function afterOpen(key) {
    if (backupKey() !== key) return;
    for (const fn of openHooks) {
        try { await fn(); } catch (e) { console.warn(LOG_PREFIX, e); }
    }
    if (backupKey() !== key) return;
    const a = checkAlarm();
    if (a) {
        toastActions(t('backup.alarm', { then: a.backup.total, now: a.now.total, date: new Date(a.backup.at).toLocaleString() }), [
            { label: t('backup.restoreLatest'), primary: true, run: () => restoreBackup(a.backup.slot).then((r) => toast(t('backup.restored', r), 'success')).catch((e) => toast(t('backup.restoreFail', { error: e?.message || e }), 'error')) },
            { label: t('backup.alarmDismiss'), run: () => dismissAlarm() },
        ], { timeOut: 0, type: 'warning' });
        return;
    }
    await maybeBackup('open');
}

export function scheduleOpenCheck() {
    clearTimeout(openTimer);
    alarm = null;
    const key = backupKey();
    if (!key) return;
    openTimer = setTimeout(() => afterOpen(key).catch((e) => console.warn(LOG_PREFIX, e)), OPEN_DELAY_MS);
}

export function initAutoBackup() {
    const c = ctx();
    if (c?.eventSource && c.eventTypes) c.eventSource.on(c.eventTypes.CHAT_CHANGED, scheduleOpenCheck);
    onSummaryChange(() => {
        clearTimeout(floorTimer);
        floorTimer = setTimeout(() => maybeBackup('floors').catch((e) => console.warn(LOG_PREFIX, e)), FLOOR_DELAY_MS);
    });
    scheduleOpenCheck();
}
