// 只送相關的記事＋回憶召回（第 6 步）。
//
// 每次生成前，看「這次會送出的最新原文」（保留原文的那幾層＋剛送出的話）在講什麼：
//   記事：主角的人物卡、手動釘選的一定送；名字有出現的、最近幾層出場或變動過的也送；
//         有設定向量模型的話，再補上意思最接近的幾條。
//   回憶：已經被壓縮成章的舊樓層，挑幾層相關的單層摘要一起送（章總結只有大概，細節在單層裡）。
//   以前的日記（v0.13.36）：最近幾天以外的日記，挑幾段相關的一起送（找法和回憶一樣）。
// 沒設定向量模型、或向量出錯時，只用關鍵字（名字、地點）。
//
// v0.13.51（使用者回報：寫了「萬聖節」，萬聖節的事完全沒有召回）：
//   以前只拿「最近原文的最後 1500 字」去比，大部分是 AI 的長回覆，使用者那句短短的話幾乎沒影響；
//   關鍵字也只看人物、物件、地點的名字。現在：
//   - 向量另外拿使用者最新的話單獨比一次，取兩個分數裡高的；
//   - 使用者最新的話裡的詞，在回憶／日記裡很少見的（例如萬聖節），有出現就算相關（同樣的詞）；
//   - 節日和日期（萬聖節→10-31、10月31日）對到那天的回憶和日記（同一天）。

import { ctx, LOG_PREFIX } from './util.js';
import { getSettings, isTracked } from './settings.js';
import { chatKey, getChat, getEntry, isAiMessage } from './chat.js';
import { getNotes, leadRoles, noteLine } from './notes.js';
import { sceneLine } from './lines.js';
import { structure } from './compress.js';
import { cosine } from './api/embed.js';
import { ApiError } from './api/custom.js';
import { getVectors } from './vectors.js';
import { errorText } from './errors.js';
import { cleanForSummary } from './filter.js';
import { diaryPlan } from './diarysend.js';
import { normDate } from './calendar.js';
import { hasTtChatApi, searchChats } from './tthost.js';
import { diaryRanges } from './diary.js';
import { t } from './i18n.js';

/** 拿來比對向量的「最近原文」最多取多少字（取最後面的）。 */
const QUERY_CHARS = 1500;
/** 向量最多等多久，超過就改用關鍵字，不要卡住生成。 */
const VECTOR_TIMEOUT_MS = 25000;
/** 預覽時向量出錯後，多久之內不再重試（避免每次重畫都去連）。 */
const PREVIEW_BACKOFF_MS = 60000;
/** 記憶召回：有出現共同的名字或地點時，每個加多少分（向量分數 0～1）。 */
const KEYWORD_BONUS = 0.05;
/** 同樣的少見詞、同一天：加多少分（比名字重，使用者特地寫出來的）。 */
const WORD_BONUS = 0.12;
const DATE_BONUS = 0.15;
/** 使用者最新的話最多看多少字。 */
const FOCUS_CHARS = 400;

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

/**
 * 使用者最新的話（這次剛送出的；重新生成時是上一句）。連續好幾則都算。
 * 比對用，不含 AI 的回覆（AI 的長回覆會蓋過使用者短短的一句）。
 */
function focusText(limit) {
    const chat = getChat();
    const out = [];
    let ai = 0;
    for (let i = limit - 1; i >= 0; i--) {
        const m = chat[i];
        if (!m || m.is_system || typeof m.mes !== 'string') continue;
        if (m.is_user) out.unshift(cleanForSummary(m.mes));
        else if (out.length || ++ai > 2) break;
    }
    return out.join('\n').slice(-FOCUS_CHARS).toLowerCase();
}

/** 節日 → 月-日（農曆的節日每年不同，不放）。 */
const HOLIDAYS = [
    [/萬聖|万圣|halloween/i, '10-31'],
    [/平安夜|聖誕夜|圣诞夜|christmas eve/i, '12-24'],
    [/聖誕節|圣诞节|聖誕|圣诞|christmas|xmas/i, '12-25'],
    [/跨年|除夕夜|new year'?s eve/i, '12-31'],
    [/元旦|new year'?s day/i, '01-01'],
    [/白色情人節|白色情人节|white day/i, '03-14'],
    [/(?<!白色)情人節|(?<!白色)情人节|valentine/i, '02-14'],
    [/愚人節|愚人节|april fool/i, '04-01'],
];
const pad2 = (x) => String(x).padStart(2, '0');

/** 使用者的話裡提到的日子：Set('10-31', …)（節日，和「10月31日」「10/31」這種寫法）。 */
export function focusDays(text) {
    const out = new Set();
    let rest = String(text ?? '');
    for (const [re, day] of HOLIDAYS) {
        if (re.test(rest)) {
            out.add(day);
            // 「聖誕夜」已經算平安夜了，不要再算成聖誕節。
            rest = rest.replace(new RegExp(re.source, 'gi'), ' ');
        }
    }
    for (const m of String(text ?? '').matchAll(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日號号]|(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/g)) {
        const mm = Number(m[1] ?? m[3]);
        const dd = Number(m[2] ?? m[4]);
        if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) out.add(`${pad2(mm)}-${pad2(dd)}`);
    }
    return out;
}

const HAN = /[\u3400-\u9fff\uf900-\ufaff]+/g;
/**
 * 虛字、代名詞、常見動詞（含有這些字的片段不拿來比）。用使用者的真實聊天紀錄（本機）試過：
 * 不濾的話，長長的一句話裡總有幾個片段碰巧很少見（「你還不」「不要在」），每回都會亂找回。
 */
const FUNC = new Set([...'你我他她它您們们的地得了著着過过是在不沒没就都也還还把被讓让給给會会要想說说看這这那個个嗎吗呢吧啊呀哦喔嗯欸哈啦嘛麼么什怎誰谁哪裡里很太更最又再才只已和跟與与或而且但卻却如果因為为所以然後后一二兩两些點点下上來来去到從从對对向往能可以自己有好大小多少鐘钟']);
/** 時間的說法（不能只濾「明」這個字，不然「孔明燈」也會被濾掉）。 */
const TIME_WORDS = /今天|明天|昨天|今晚|明晚|昨晚|今早|明早|今年|明年|去年|前天|後天|后天|現在|现在/;
/** 中文片段至少幾個字（兩個字的太常碰巧出現，交給向量和日期）。 */
const TERM_MIN = 3;

/** 使用者的話裡拿來比對的詞：中文連續 3～4 字、不含虛字的片段，英文 3 個字母以上的字。 */
function termsOf(text, names) {
    const out = new Set();
    for (const run of text.match(HAN) ?? []) {
        for (let n = TERM_MIN; n <= 4; n++) {
            for (let i = 0; i + n <= run.length; i++) {
                const w = run.slice(i, i + n);
                if (![...w].some((ch) => FUNC.has(ch)) && !TIME_WORDS.test(w)) out.add(w);
            }
        }
    }
    for (const w of text.match(/[a-z][a-z0-9'-]{2,}/g) ?? []) out.add(w);
    return [...out].filter((x) => !names.some((a) => a.includes(x) || x.includes(a)));
}

/**
 * 每段文字裡出現的少見詞（使用者的話裡有、而且只出現在少數幾段裡的：最多 2%，至少容許 3 段）。
 * 回傳和 lines 同順序的陣列，每個是最長的那幾個詞（「萬聖節派」對到了就不再算「萬聖節」）。
 */
function rareWords(terms, lines) {
    if (!terms.length || !lines.length) return lines.map(() => []);
    const lower = lines.map((x) => x.toLowerCase());
    const max = Math.max(3, Math.ceil(lines.length * 0.02));
    const rare = terms.filter((w) => {
        let df = 0;
        for (const l of lower) if (l.includes(w) && ++df > max) return false;
        return df > 0;
    });
    return lower.map((l) => {
        const hit = rare.filter((w) => l.includes(w));
        return hit.filter((w) => !hit.some((o) => o !== w && o.includes(w)));
    });
}

/** 一段的分數加上關鍵字、少見詞、同一天；說明它為什麼被挑上。 */
function explain(c, sims, threshold) {
    const bonus = c.shared * KEYWORD_BONUS + c.words.length * WORD_BONUS + (c.sameDay ? DATE_BONUS : 0);
    const vector = Boolean(sims && c.sim >= threshold);
    const reason = c.words.length ? 'word' : c.sameDay ? 'date' : vector ? 'vector' : 'keyword';
    const term = reason === 'word' ? c.words.slice(0, 2).join('、') : reason === 'date' ? c.date.slice(5) : '';
    // rank（不叫 total：日記的段落本身就有 total＝那天有幾段）。
    return { rank: (sims ? c.sim : 0) + bonus, reason, term, hit: c.shared > 0 || c.words.length > 0 || c.sameDay || vector };
}

/** 粗估 token（和 hide.js 的 estimateTokens 一樣；這裡另寫一份免得互相 import）。 */
function roughTokens(s) {
    const str = String(s ?? '');
    const cjk = (str.match(/[㐀-鿿豈-﫿]/g) ?? []).length;
    return Math.ceil(cjk / 1.2 + (str.length - cjk) / 4);
}

/** 一段文字裡有哪些使用者的話裡的詞（最長的那幾個）。 */
function wordsIn(text, terms) {
    const lower = String(text ?? '').toLowerCase();
    const hit = terms.filter((w) => lower.includes(w));
    return hit.filter((w) => !hit.some((o) => o !== w && o.includes(w)));
}

/** 原文片段最多送幾段（找不到是哪天日記的舊聊天原文）。 */
const RAW_MAX = 3;
const RAW_CHARS = 160;

/**
 * TT 的原文全文搜尋（v0.13.56，使用者要求）：用使用者最新的話搜現在的聊天和寫過日記的那幾個舊聊天的原文。
 * 摘要、日記沒寫到的細節也找得到。搜到的那一層：
 *   現在的聊天 → 那一層的單層回憶（已經壓縮成章的）加分；
 *   舊聊天 → 用日記記的樓層範圍找出是哪一天，那天的日記加分；找不到是哪天的，送一小段原文（最多 RAW_MAX 段）。
 * 搜到的那層要有使用者的話裡的詞（3 字以上、不含虛字）才算，免得只對到「你」「了」這種字。
 * 不是 TT、或關掉了：回傳空的，照原本的方式找。
 */
async function searchRaw(focus, terms, candidates, diaryCands, limit, diaryTopK) {
    if (!terms.length || !hasTtChatApi()) return [];
    const query = focus.trim().slice(-200);
    const ranges = diaryRanges();
    const me = chatKey();
    const others = [...new Set(ranges.flatMap((d) => d.chats))].filter((id) => id && id !== me);
    const hits = await searchChats(query, [null, ...others]);
    if (!hits?.length) return [];
    const chat = getChat();
    const byIndex = new Map(candidates.map((c) => [c.index, c]));
    const byDate = new Map();
    for (const c of diaryCands) {
        if (!byDate.has(c.date)) byDate.set(c.date, []);
        byDate.get(c.date).push(c);
    }
    const raw = [];
    const add = (c, w) => { c.words = [...new Set([...(c.words ?? []), ...w])]; };
    for (const h of hits) {
        const w = wordsIn(cleanForSummary(h.text), terms);
        if (!w.length) continue;
        if (h.chat === null) {
            if (h.index >= limit) continue;
            // 使用者的話：算進後面那層 AI 回覆。
            let i = h.index;
            while (i < chat.length && !isAiMessage(chat[i])) i++;
            const c = byIndex.get(i);
            if (c) add(c, w);
            continue;
        }
        const day = ranges.find((d) => d.ranges.some((x) => x.chat === h.chat && h.index >= x.from && h.index <= x.to));
        const units = day ? byDate.get(day.date) : null;
        if (units?.length) {
            units.forEach((c) => add(c, w));
            continue;
        }
        if (day || !diaryTopK || raw.length >= RAW_MAX) continue;
        const text = cleanForSummary(h.snippet || h.text).replace(/\s+/g, ' ').trim().slice(0, RAW_CHARS);
        if (!text || raw.some((x) => x.line.includes(text))) continue;
        raw.push({ kind: 'raw', key: `raw#${h.chat}#${h.index}`, date: '', part: 0, total: 1, line: `${t('inject.rawSnippet')}${text}`, shared: 0, sim: 0,
            reason: 'word', term: w.slice(0, 2).join('、'), rank: WORD_BONUS * w.length, hit: true });
    }
    return raw;
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
 *   notes: Map<id, { reason: 'pinned'|'lead'|'mention'|'recent'|'word'|'vector', score?, term? }>,
 *   total: 進行中的記事總數（有勾選記錄的類型）,
 *   memories: [{ index, line, reason: 'keyword'|'vector'|'word'|'date', term, score, shared }]（依樓層順序）,
 *   diary: [{ key, date, part, total, line, reason, term, score, shared }]（以前的日記，依日期順序）,
 *   （word：使用者的話裡少見的詞也出現在這段，term 是那個詞；date：同一天，term 是月-日。）
 *   vector: 'off' | 'ok' | 'error', error: 錯誤訊息,
 * }
 * preview：大視窗預覽用；向量剛出錯時先不重試。
 */
export async function selectRelevant({ keepFrom, limit = getChat().length, preview = false } = {}) {
    const s = getSettings();
    const r = s.recall ?? {};
    const notes = [...getNotes().notes.values()].filter((n) => n.state !== 'done' && isTracked(n.type));
    const text = scanText(keepFrom, limit).toLowerCase();
    const focus = focusText(limit);
    // 人物、物件的名字另外算（名字有出現），不重複算成少見的詞。
    const terms = focus.trim() ? termsOf(focus, [...leadNames(), ...entityAliases()]) : [];
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
        // 使用者的話裡少見的詞也出現在記事裡（例如約定「萬聖節去鬼屋」）。
        const noteWords = rareWords(terms, rest.map(noteLine));
        rest.map((n, k) => ({ n, w: noteWords[k] }))
            .filter((x) => x.w.length)
            .slice(0, Math.max(0, Number(r.noteTopK) || 0))
            .forEach((x) => out.notes.set(x.n.id, { reason: 'word', term: x.w.slice(0, 2).join('、') }));
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
            candidates.push({ index: i, line, date: normDate(e.date) || '', shared: sharedCount(line, e.location, entities, text), score: 0, reason: null });
        }
    }

    // ===== 以前的日記：最近幾天以外的 =====
    const diaryTopK = Math.max(0, Math.floor(Number(s.diary?.recallTopK) || 0));
    const diaryCands = [];
    if (diaryTopK) {
        entities ??= entityAliases();
        for (const u of diaryPlan().older) diaryCands.push({ ...u, shared: sharedCount(u.line, u.location, entities, text) });
    }

    // ===== 使用者最新的話：少見的詞、提到的日子 =====
    const days = focusDays(focus);
    const all = [...candidates, ...diaryCands];
    const words = rareWords(terms, all.map((c) => c.line));
    all.forEach((c, k) => {
        c.words = words[k];
        c.sameDay = Boolean(c.date && days.has(c.date.slice(5)));
    });

    // ===== TT：原文全文搜尋（v0.13.56） =====
    const rawHits = r.ttSearch === false ? [] : await searchRaw(focus, terms, candidates, diaryCands, limit, diaryTopK);

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
                // 使用者最新的話另外比一次，取高的（v0.13.51）。
                const queries = focus.trim() && focus.trim() !== query.trim() ? [query, focus] : [query];
                const inputs = [...queries, ...rest.map(noteLine), ...candidates.map((c) => c.line), ...diaryCands.map((c) => c.line)];
                const { vectors, fetched } = await withTimeout(getVectors(cfg, inputs), VECTOR_TIMEOUT_MS);
                sims = vectors.slice(queries.length).map((v) => Math.max(...queries.map((_, q) => cosine(vectors[q], v))));
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
            .filter((x) => x.score >= threshold && !out.notes.has(x.n.id))
            .sort((a, b) => b.score - a.score)
            .slice(0, Math.max(0, Number(r.noteTopK) || 0))
            .forEach((x) => out.notes.set(x.n.id, { reason: 'vector', score: x.score }));
    }

    // ===== 挑：同一天合併、總字數上限（v0.13.56，使用者問：相關的不只 3～5 段怎麼辦） =====
    // 回憶和日記放在一起，照分數由高到低挑：每種有段數上限，加起來不超過 recall.budget（token，0＝不限）。
    // 同一天：挑了那天的日記，那天的單層回憶就不用再送（日記比較完整），已經挑的會換掉。
    const memTopK = Math.max(0, Number(r.memoryTopK) || 0);
    const pool = [
        ...candidates.map((c, k) => {
            const sim = sims ? sims[rest.length + k] : 0;
            return { kind: 'memory', ...c, sim, ...explain({ ...c, sim }, sims, threshold) };
        }),
        ...diaryCands.map((c, k) => {
            const sim = sims ? sims[rest.length + candidates.length + k] : 0;
            return { kind: 'diary', ...c, sim, ...explain({ ...c, sim }, sims, threshold) };
        }),
    ].filter((c) => c.hit);
    pool.push(...rawHits);
    // 分數一樣時，比較新的優先。
    pool.sort((a, b) => b.rank - a.rank || (b.date || '').localeCompare(a.date || '') || (b.index ?? 0) - (a.index ?? 0));
    const budget = Math.max(0, Number(r.budget) || 0);
    const chosen = [];
    let used = 0;
    const count = (kind) => chosen.filter((c) => (c.kind === 'raw' ? 'diary' : c.kind) === kind).length;
    for (const c of pool) {
        const kind = c.kind === 'raw' ? 'diary' : c.kind;
        if (count(kind) >= (kind === 'memory' ? memTopK : diaryTopK)) continue;
        if (c.kind === 'memory' && c.date && chosen.some((x) => x.kind === 'diary' && x.date === c.date)) continue;
        const cost = roughTokens(c.line);
        // 一定至少送一段（就算比上限長）。
        if (budget && chosen.length && used + cost > budget) continue;
        if (c.kind === 'diary' && c.date) {
            for (let k = chosen.length - 1; k >= 0; k--) {
                if (chosen[k].kind === 'memory' && chosen[k].date === c.date) {
                    used -= roughTokens(chosen[k].line);
                    chosen.splice(k, 1);
                }
            }
        }
        chosen.push(c);
        used += cost;
    }
    out.memories = chosen.filter((c) => c.kind === 'memory')
        .map((c) => ({ index: c.index, line: c.line, shared: c.shared, score: sims ? c.sim : null, reason: c.reason, term: c.term }))
        .sort((a, b) => a.index - b.index);
    out.diary = chosen.filter((c) => c.kind !== 'memory')
        .map(({ key, date, part, total, line, shared, sim, reason, term, kind }) => ({ key, date, part, total, line, shared, score: sims && kind === 'diary' ? sim : null, reason, term, ...(kind === 'raw' ? { raw: true } : {}) }))
        .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.part - b.part);
    out.tokens = used;
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
