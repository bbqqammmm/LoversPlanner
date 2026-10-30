// 記憶範圍：
//   角色的共同設定（套用到這個角色之後開的所有新聊天）：'none' 不帶 | 'copy' 複製帶走 | 'share' 即時共用
//   本視窗的設定（只影響目前這個聊天）：'inherit' 跟隨角色 | 'own' 獨立 | 'share' 即時共用
// 這裡只負責存取設定；實際的帶走／共用在 carry.js。

import { ctx, MODULE } from './util.js';
import { DEFAULTS, getSettings, saveSettings } from './settings.js';

export const SCOPE_KINDS = ['summary', 'characters', 'items', 'promises', 'todos', 'memories'];
export const CHAR_SCOPE_VALUES = ['none', 'copy', 'share'];
export const CHAT_SCOPE_VALUES = ['inherit', 'own', 'share'];

/** 目前角色卡的識別：用頭像檔名（酒館裡角色卡的唯一識別）。 */
export function characterKey() {
    const c = ctx();
    const ch = c?.characters?.[c.characterId];
    return ch?.avatar ?? null;
}

/**
 * 聊天搬到別的酒館後被改了名（酒館導入聊天會換檔名，v0.13.52）：舊的 id 換成現在的 id。
 * 改名紀錄在 characters[頭像].renamed（導入打包檔時認出來的）。沒改過名就原樣回傳。
 */
export function currentChatId(id, avatar = characterKey()) {
    const renamed = avatar ? getSettings().characters?.[avatar]?.renamed : null;
    let cur = id;
    for (let k = 0; renamed && k < 10 && renamed[cur] && renamed[cur] !== cur; k++) cur = renamed[cur];
    return cur;
}

export function characterName() {
    const c = ctx();
    return c?.characters?.[c.characterId]?.name ?? c?.name2 ?? '';
}

function characterRecord(create) {
    const key = characterKey();
    if (!key) return null;
    const all = getSettings().characters;
    if (!all[key] && create) all[key] = {};
    return all[key] ?? null;
}

export function getCharacterScope() {
    const rec = characterRecord(false);
    return { ...DEFAULTS.scope, ...(rec?.scope ?? {}) };
}

export function setCharacterScope(kind, value) {
    if (!SCOPE_KINDS.includes(kind) || !CHAR_SCOPE_VALUES.includes(value)) return;
    const rec = characterRecord(true);
    if (!rec) return;
    rec.scope = { ...getCharacterScope(), [kind]: value };
    saveSettings();
}

function chatRecord(create) {
    const meta = ctx()?.chatMetadata;
    if (!meta) return null;
    if (!meta[MODULE] && create) meta[MODULE] = {};
    return meta[MODULE] ?? null;
}

export function getChatScope() {
    const rec = chatRecord(false);
    const out = {};
    for (const kind of SCOPE_KINDS) {
        const v = rec?.scope?.[kind];
        out[kind] = CHAT_SCOPE_VALUES.includes(v) ? v : 'inherit';
    }
    return out;
}

export function setChatScope(kind, value) {
    if (!SCOPE_KINDS.includes(kind) || !CHAT_SCOPE_VALUES.includes(value)) return;
    const rec = chatRecord(true);
    if (!rec) return;
    rec.scope = { ...getChatScope(), [kind]: value };
    const c = ctx();
    try {
        if (typeof c?.saveMetadataDebounced === 'function') c.saveMetadataDebounced();
        else c?.saveMetadata?.();
    } catch (e) { /* 忽略 */ }
}
