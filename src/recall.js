// 只送相關的記事＋回憶召回（第 6 步）。
//
// 每次生成前，看「這次會送出的最新原文」（保留原文的那幾層＋剛送出的話）在講什麼：
//   記事：主角的人物卡、手動釘選的一定送；名字有出現的、最近幾層出場或變動過的也送；
//         有設定向量模型的話，再補上意思最接近的幾條。
//   回憶：已經被壓縮成章的舊樓層，挑幾層相關的單層摘要一起送（章總結只有大概，細節在單層裡）。
//   以前的日記（v0.13.36）：最近幾天以外的日記，挑幾段相關的一起送（找法和回憶一樣）。
// 沒設定向量模型、或向量出錯時，只用關鍵字（名字、地點）。

import { ctx, LOG_PREFIX } from './util.js';
import { getSettings, isTracked } from './settings.js';
import { getChat, getEntry, isAiMessage } from './chat.js';
import { getNotes, leadRoles, noteLine } from './notes.js';
import { sceneLine } from './lines.js';
import { structure } from './compress.js';
import { cosine } from './api/embed.js';
import { ApiError } from './api/custom.js';
import { getVectors } from './vectors.js';
import { errorText } from './errors.js';
import { cleanForSummary } from './filter.js';
import { diaryPlan } from './diarysend.js';

/** 拿來比對向量的「最近原文」最多取多少字（取最後面的）。 */
const QUERY_CHARS = 1500;
/** 向量最多等多久，超過就改用關鍵字，不要卡住生成。 */
const VECTOR_TIMEOUT_MS = 25000;
/** 預覽時向量出錯後，多久之內不再重試（避免每次重畫都去連）。 */
const PREVIEW_BACKOFF_MS = 60000;
/** 記憶召回：有出現共同的名字或地點時，每個加多少分（向量分數 0～1）。 */
const KEYWORD_BONUS = 0.05;

const CJK = /[㐀-鿿豈-﫿぀-ヿ가-힯]/;

function longEnough(s) {
    const cjk = [...s].filter((ch) => CJK.test(ch)).length;
    return cjk >= 2 || (cjk === 0 && s.length >= 3) || (cjk === 1 && s.length >= 3);
}

/** 名字拆成可以比對的別名：「林曉（小曉）」→ 林曉（小曉）、林曉、小曉。太短的不用（容易誤判）。 */
export function aliasesOf(name) {
    const full = String(name ?? '').trim();
    const parts = full.split(/[()（）[\]【】「」『』/／、,，;；·・|｜\s]+/).map((x) => x.trim()).filter(Boolean);
    return [...new Set([full, ...parts])].filter((a) => a && longEnough(a)).map((a) => a.toLowerCase());
}

function mentioned(aliases, text) {
    return aliases.some((a) => text.includes(a));
}

/** 兩組別名是不是同一個人（相等，或其中一個包含另一個）。 */
function sameName(a, b) {
    return a.some((x) => b.some((y) => x === y || x.includes(y) || y.includes(x)));
}

function leadAliases() {
    const c = ctx();
    return [c?.name1, c?.name2].map(aliasesOf).filter((x) => x.length);
}

export function isLead(note, leads = leadAliases(), roles = null) {
    if (note.type !== 'character') return false;
    // 指定（或自動認出）是 {{user}}／{{char}} 的人物。
    if ((roles ?? leadRoles()).has(note.id)) return true;
    const mine = aliasesOf(note.data.name);
    return leads.some((l) => sameName(mine, l));
}

/**
 * 記事裡哪些名字可以拿來比對：人物、物件看名字；約定看「和誰」。
 * 主角（{{char}}、{{user}} 和他們的別名）不算（v0.13.38，使用者回報：約定的「和誰」幾乎都是主角，
 * 每回都提到名字，結果每條約定都被當成「提到名字」送出去）。約定的「和誰」裡有主角的名字也不算（例如「為小雨」）。
 */
function noteAliases(note, leads = []) {
    const isLeadName = (a, loose) => leads.some((l) => a === l || (loose && (a.includes(l) || l.includes(a))));
    let list = [];
    if (note.type === 'character') list = [...aliasesOf(note.data.name), ...String(note.data.alias ?? '').split(/[、,，/／;；]+/).flatMap(aliasesOf)];
    else if (note.type === 'item') list = aliasesOf(note.data.name);
    else if (note.type === 'promise') return aliasesOf(note.data.with).filter((a) => !isLeadName(a, true));
    return list.filter((a) => !isLeadName(a, false));
}

/** 主角的所有名字：{{char}}、{{user}}，和指定成主角的人物記事的名字、別名。 */
function leadNames(roles = leadRoles()) {
    const out = new Set(leadAliases().flat());
    for (const n of getNotes().notes.values()) {
        if (n.type !== 'character' || !isLead(n, undefined, roles)) continue;
        for (const a of noteAliases(n)) out.add(a);
    }
    return [...out];
}

/** 這次會送出的最新原文（保留原文的那幾層＋剛送出的話）。 */
function scanText(keepFrom, limit) {
    const chat = getChat();
    const out = [];
    for (let i = Math.max(0, keepFrom); i < limit; i++) {
        const m = chat[i];
        if (m && !m.is_system && typeof m.mes === 'string') out.push(cleanForSummary(m.mes));
    }
    return out.join('\n');
}

/** 最近 n 個 AI 樓層：出場的人物名字，以及有變動的記事 id。 */
function recentActivity(limit, n) {
    const chat = getChat();
    const floors = [];
    for (let i = limit - 1; i >= 0 && floors.length < n; i--) if (isAiMessage(chat[i])) floors.push(i);
    const cast = [];
    const touched = new Set();
    const { perFloor } = getNotes();
    for (const i of floors) {
        const e = getEntry(i);
        if (e?.status === 'ok' && Array.isArray(e.characters)) cast.push(...e.characters.map(aliasesOf).filter((x) => x.length));
        for (const { op, valid } of perFloor.get(i) ?? []) if (valid) touched.add(op.id);
    }
    return { cast, touched };
}

/** 拿來比對的名字：人物、物件（主角除外，他們到處都會出現）。 */
function entityAliases() {
    const leads = leadAliases();
    const roles = leadRoles();
    const out = new Set();
    for (const n of getNotes().notes.values()) {
        if ((n.type === 'character' || n.type === 'item') && !isLead(n, leads, roles)) aliasesOf(n.data.name).forEach((a) => out.add(a));
    }
    return out;
}

/** 一段文字和最近原文共同出現的名字、地點有幾個。 */
function sharedCount(line, location, entities, text) {
    const lower = line.toLowerCase();
    const places = isTracked('location') ? aliasesOf(location) : [];
    return [...new Set([...entities, ...places])].filter((a) => lower.includes(a) && text.includes(a)).length;
}

let lastVectorError = { at: 0, text: '' };

function vectorConfig() {
    const v = getSettings().recall?.vector;
    return v?.enabled && v.url && v.model ? v : null;
}

function withTimeout(promise, ms) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new ApiError('timeout')), ms); }),
    ]).finally(() => clearTimeout(timer));
}

/**
 * 挑出這次要送的記事和回憶。
 * 回傳 {
 *   filtered: 有沒有在挑記事（關掉「只送相關」時是 false，記事全送）,
 *   notes: Map<id, { reason: 'pinned'|'lead'|'mention'|'recent'|'vector', score? }>,
 *   total: 進行中的記事總數（有勾選記錄的類型）,
 *   memories: [{ index, line, reason: 'keyword'|'vector', score, shared }]（依樓層順序）,
 *   diary: [{ key, date, part, total, line, reason, score, shared }]（以前的日記，依日期順序）,
 *   vector: 'off' | 'ok' | 'error', error: 錯誤訊息,
 * }
 * preview：大視窗預覽用；向量剛出錯時先不重試。
 */
export async function selectRelevant({ keepFrom, limit = getChat().length, preview = false } = {}) {
    const s = getSettings();
    const r = s.recall ?? {};
    const notes = [...getNotes().notes.values()].filter((n) => n.state !== 'done' && isTracked(n.type));
    const text = scanText(keepFrom, limit).toLowerCase();
    const out = { filtered: Boolean(r.notes), notes: new Map(), total: notes.length, memories: [], diary: [], vector: 'off', error: '', fetched: 0 };

    // ===== 記事：一定送的、名字有出現的、最近的 =====
    const rest = [];
    if (out.filtered) {
        const leads = leadAliases();
        const roles = leadRoles();
        const names = leadNames(roles);
        const { cast, touched } = recentActivity(limit, Number(r.recentFloors) || 0);
        for (const n of notes) {
            let reason = null;
            if (n.pinned) reason = 'pinned';
            else if (isLead(n, leads, roles)) reason = 'lead';
            else if (mentioned(noteAliases(n, names), text)) reason = 'mention';
            else if (touched.has(n.id) || (n.type === 'character' && cast.some((c) => sameName(aliasesOf(n.data.name), c)))) reason = 'recent';
            if (reason) out.notes.set(n.id, { reason });
            else rest.push(n);
        }
    }

    // ===== 回憶：已經壓縮成章的舊樓層 =====
    const candidates = [];
    let entities = null;
    if (r.memory) {
        const st = structure();
        entities = entityAliases();
        for (const i of [...st.covered].sort((a, b) => a - b)) {
            if (i >= limit) continue;
            const e = getEntry(i);
            if (e?.status !== 'ok' || !e.summary) continue;
            const line = sceneLine(e);
            candidates.push({ index: i, line, shared: sharedCount(line, e.location, entities, text), score: 0, reason: null });
        }
    }

    // ===== 以前的日記：最近幾天以外的 =====
    const diaryTopK = Math.max(0, Math.floor(Number(s.diary?.recallTopK) || 0));
    const diaryCands = [];
    if (diaryTopK) {
        entities ??= entityAliases();
        for (const u of diaryPlan().older) diaryCands.push({ ...u, shared: sharedCount(u.line, u.location, entities, text) });
    }

    // ===== 向量 =====
    const cfg = vectorConfig();
    let sims = null;
    if (cfg && text.trim() && (rest.length || candidates.length || diaryCands.length)) {
        if (preview && Date.now() - lastVectorError.at < PREVIEW_BACKOFF_MS) {
            out.vector = 'error';
            out.error = lastVectorError.text;
        } else {
            try {
                const query = text.slice(-QUERY_CHARS);
                const inputs = [query, ...rest.map(noteLine), ...candidates.map((c) => c.line), ...diaryCands.map((c) => c.line)];
                const { vectors, fetched } = await withTimeout(getVectors(cfg, inputs), VECTOR_TIMEOUT_MS);
                sims = vectors.slice(1).map((v) => cosine(vectors[0], v));
                out.fetched = fetched;
                out.vector = 'ok';
            } catch (e) {
                console.warn(LOG_PREFIX, '向量失敗，這次只用關鍵字', e);
                out.vector = 'error';
                out.error = errorText(e);
                lastVectorError = { at: Date.now(), text: out.error };
            }
        }
    }
    const threshold = (Number(r.threshold) || 0) / 100;

    if (sims && out.filtered) {
        rest.map((n, k) => ({ n, score: sims[k] }))
            .filter((x) => x.score >= threshold)
            .sort((a, b) => b.score - a.score)
            .slice(0, Math.max(0, Number(r.noteTopK) || 0))
            .forEach((x) => out.notes.set(x.n.id, { reason: 'vector', score: x.score }));
    }

    if (candidates.length) {
        const topK = Math.max(0, Number(r.memoryTopK) || 0);
        const scored = candidates.map((c, k) => {
            const sim = sims ? sims[rest.length + k] : 0;
            return { ...c, sim, score: sim + c.shared * KEYWORD_BONUS };
        });
        const picked = scored
            .filter((c) => c.shared > 0 || (sims && c.sim >= threshold))
            // 分數一樣時，比較新的優先。
            .sort((a, b) => (sims ? b.score - a.score : b.shared - a.shared) || b.index - a.index)
            .slice(0, topK)
            .map((c) => ({ index: c.index, line: c.line, shared: c.shared, score: sims ? c.sim : null, reason: sims && c.sim >= threshold ? 'vector' : 'keyword' }));
        out.memories = picked.sort((a, b) => a.index - b.index);
    }

    if (diaryCands.length) {
        const offset = rest.length + candidates.length;
        out.diary = diaryCands
            .map((c, k) => ({ ...c, sim: sims ? sims[offset + k] : 0 }))
            .filter((c) => c.shared > 0 || (sims && c.sim >= threshold))
            .sort((a, b) => (sims ? (b.sim + b.shared * KEYWORD_BONUS) - (a.sim + a.shared * KEYWORD_BONUS) : b.shared - a.shared) || b.date.localeCompare(a.date))
            .slice(0, diaryTopK)
            .map(({ key, date, part, total, line, shared, sim }) => ({ key, date, part, total, line, shared, score: sims ? sim : null, reason: sims && sim >= threshold ? 'vector' : 'keyword' }))
            .sort((a, b) => a.date.localeCompare(b.date) || a.part - b.part);
    }
    return out;
}

/** 預先把所有記事和舊樓層摘要轉好向量（設定頁的按鈕）。回傳 { total, fetched }。 */
export async function warmVectors() {
    const cfg = vectorConfig();
    if (!cfg) throw new ApiError('need_vector');
    const texts = [...getNotes().notes.values()].filter((n) => n.state !== 'done' && isTracked(n.type)).map(noteLine);
    const chat = getChat();
    for (let i = 0; i < chat.length; i++) {
        const e = isAiMessage(chat[i]) ? getEntry(i) : null;
        if (e?.status === 'ok' && e.summary) texts.push(sceneLine(e));
    }
    if (Number(getSettings().diary?.recallTopK) > 0) texts.push(...diaryPlan().older.map((u) => u.line));
    const { fetched } = await getVectors(cfg, texts);
    return { total: texts.length, fetched };
}
