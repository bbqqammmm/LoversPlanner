// 💬 你的偏好（v0.13.36，日記第三階段，使用者要求：OOC 要求可以自選要不要記下來）：
//   {{user}} 在 OOC（劇情外的說明）裡對角色提出的長期要求，例如「希望他更主動」「別一直重複我的話」。
//   設定 › 你的偏好 打開「自動記下」後，單層摘要和寫日記時讓模型順便挑出來（同一次呼叫，不多花錢）；
//   也可以自己寫。每回送給角色（可以一條一條暫停）。一次性的指示（這段寫長一點、繼續）不算。
//   存在角色卡自己的資料裡（settings.characters[頭像].prefs），換新聊天也在。
//   刪掉的記在 prefsRemoved（比對用的寫法），之後模型再挑到同一句不會又加回來。

import { LOG_PREFIX } from './util.js';
import { getSettings, saveSettings } from './settings.js';
import { characterKey } from './scope.js';

const MAX_PREFS = 30;
const MAX_LEN = 120;
/** 模型挑的太短（例如「繼續」「重寫」）多半是一次性的指示，不記。 */
const MIN_MODEL_LEN = 4;

const listeners = new Set();
export function onPrefsChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
function changed() {
    saveSettings();
    for (const fn of listeners) {
        try { fn(); } catch (e) { console.error(LOG_PREFIX, e); }
    }
}

function record(create) {
    const key = characterKey();
    if (!key) return null;
    const all = getSettings().characters;
    if (!all[key] && create) all[key] = {};
    return all[key] ?? null;
}

/** 比對用的寫法：拿掉空白、標點、大小寫。 */
function norm(text) {
    return String(text ?? '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function clean(text) {
    return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);
}

/** 目前角色的偏好：[{ id, text, at, from: 'ooc'|'diary'|'manual', off? }]。 */
export function listPrefs() {
    const list = record(false)?.prefs;
    return Array.isArray(list) ? list : [];
}

/** 和已有的一樣、或互相包含，就算重複。 */
function duplicateOf(text, list) {
    const k = norm(text);
    return list.find((p) => {
        const o = norm(p.text);
        return o === k || (k.length >= 4 && o.includes(k)) || (o.length >= 4 && k.includes(o));
    }) ?? null;
}

/** 自己寫一條。回傳新增的那條（重複或空的回傳 null）。 */
export function addPref(text, from = 'manual') {
    const value = clean(text);
    if (!value || !characterKey()) return null;
    const rec = record(true);
    rec.prefs = Array.isArray(rec.prefs) ? rec.prefs : [];
    if (duplicateOf(value, rec.prefs)) return null;
    if (from === 'manual') rec.prefsRemoved = (rec.prefsRemoved ?? []).filter((k) => k !== norm(value));
    const pref = { id: `pf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text: value, at: Date.now(), from };
    rec.prefs.push(pref);
    if (rec.prefs.length > MAX_PREFS) rec.prefs.splice(0, rec.prefs.length - MAX_PREFS);
    changed();
    return pref;
}

/** 模型挑出來的（摘要、日記）：刪過的、重複的不加。回傳新加的幾條。 */
export function addPrefsFromModel(list, from = 'ooc') {
    if (!getSettings().prefs?.auto || !Array.isArray(list)) return [];
    const removed = new Set(record(false)?.prefsRemoved ?? []);
    const out = [];
    for (const x of list) {
        const value = clean(typeof x === 'string' ? x : x?.text);
        if (!value || norm(value).length < MIN_MODEL_LEN || removed.has(norm(value))) continue;
        const p = addPref(value, from);
        if (p) out.push(p);
    }
    return out;
}

export function editPref(id, text) {
    const value = clean(text);
    const p = listPrefs().find((x) => x.id === id);
    if (!p || !value) return false;
    p.text = value;
    p.at = Date.now();
    changed();
    return true;
}

export function removePref(id) {
    const rec = record(false);
    const p = rec?.prefs?.find((x) => x.id === id);
    if (!p) return false;
    rec.prefs = rec.prefs.filter((x) => x.id !== id);
    rec.prefsRemoved = [...new Set([...(rec.prefsRemoved ?? []), norm(p.text)])].slice(-100);
    changed();
    return true;
}

/** 暫停／恢復送出這一條。 */
export function togglePref(id) {
    const p = listPrefs().find((x) => x.id === id);
    if (!p) return false;
    if (p.off) delete p.off;
    else p.off = true;
    changed();
    return true;
}

/** 注入用：{ count, text }（關掉「每回提醒角色」時是空的）。 */
export function prefsText() {
    if (getSettings().prefs?.inject === false) return { count: 0, text: '' };
    const list = listPrefs().filter((p) => !p.off);
    return { count: list.length, text: list.map((p) => `- ${p.text}`).join('\n') };
}
