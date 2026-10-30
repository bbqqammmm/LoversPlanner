// 📦 舊聊天整理（v0.13.33，日記第一階段，使用者要求）：
//   不打開聊天（打開 3000 多則的聊天會卡），直接向酒館要聊天檔來讀，只讀資料、不畫訊息。
//   只列同一個角色的聊天。可以勾好幾個一起讀：照故事日期分天、列出每天多大（之後的階段才寫日記）；
//   順便找出生理期、親熱、紀念日，可以帶進現在的聊天。舊聊天檔完全不改。
// 日期：戀人手帳的單層摘要有 date 就用；沒有就借 Horae 的 horae_meta.timestamp.story_date；都沒有就跟著前一層。
// 分支聊天（前面的訊息一樣）：同一則訊息（send_date＋內容）只算一次。

import { ctx, MODULE } from './util.js';
import { hashText, isAiMessage, isUserMessage } from './chat.js';
import { normDate } from './calendar.js';
import { characterKey } from './scope.js';
import { cleanForSummary, scanTags } from './filter.js';

/** 上次分析的每一天的內容（寫日記用，不存檔；重新整理後要再讀一次）。 */
let lastUnits = new Map();

/**
 * 某一天切好的段落：[{ part, total, units }]（每段最多 PART_FLOORS 個 AI 樓層，從使用者發言前切開）。
 * only：同一天好幾個聊天都寫到時（可能是 IF 線），只用這個聊天的（v0.13.36）；空的＝都用。
 * 沒讀過（或重新整理過）就回傳空陣列。
 */
export function dayParts(date, only = '') {
    const units = (lastUnits.get(date) ?? []).filter((u) => !only || u.chat === only);
    const ai = units.filter((u) => u.ai).length;
    if (!ai) return [];
    const total = Math.max(1, Math.ceil(ai / PART_FLOORS));
    const per = Math.ceil(ai / total);
    const out = [];
    let cur = [];
    let n = 0;
    for (const u of units) {
        if (!u.ai && n >= per && out.length < total - 1) {
            out.push(cur);
            cur = [];
            n = 0;
        }
        cur.push(u);
        if (u.ai) n++;
    }
    if (cur.length) out.push(cur);
    return out.map((list, k) => ({ part: k + 1, total: out.length, units: list }));
}

export function hasLoadedDays() {
    return lastUnits.size > 0;
}

/** 換了聊天（可能是別的角色）：上次讀到的舊聊天內容不能再用（v0.13.42，不然會寫進別的角色的聊天）。 */
export function clearLoadedDays() {
    lastUnits = new Map();
}

/** 這一天讀到的內容來自哪幾個聊天（照讀的順序）。only 同 dayParts。 */
export function dayChats(date, only = '') {
    const out = [];
    for (const u of lastUnits.get(date) ?? []) if (u.ai && u.chat && (!only || u.chat === only) && !out.includes(u.chat)) out.push(u.chat);
    return out;
}

/** 一段最多幾個 AI 樓層（太長的一天切成幾段寫日記）。 */
export const PART_FLOORS = 17;
/** 日記大約每個 AI 樓層幾個字（自然版提示詞的設定），上下限是一段的。 */
const DIARY_PER_FLOOR = 24;
const DIARY_MIN = 180;
const DIARY_MAX = 960;

function headers() {
    return { ...(ctx()?.getRequestHeaders?.() ?? { 'Content-Type': 'application/json' }) };
}

async function post(url, body) {
    const res = await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

/** 目前這個聊天的 id（聊天檔名，不含 .jsonl）。 */
function currentChatId() {
    const c = ctx();
    return String(c?.getCurrentChatId?.() ?? c?.chatId ?? '');
}

/** 同一個角色的其他聊天：[{ id, size, items, last, preview }]，新的在前。 */
export async function listOldChats() {
    const avatar = characterKey();
    if (!avatar) return [];
    const list = await post('/api/characters/chats', { avatar_url: avatar });
    if (!Array.isArray(list)) throw new Error('bad response');
    const current = currentChatId();
    return list
        .map((x) => ({
            id: String(x.file_id ?? String(x.file_name ?? '').replace(/\.jsonl$/, '')),
            size: x.file_size ?? '',
            items: Number(x.chat_items) || 0,
            last: x.last_mes ?? '',
            preview: String(x.mes ?? '').slice(0, 60),
        }))
        .filter((x) => x.id && x.id !== current)
        .sort((a, b) => (Number(new Date(b.last)) || Number(b.last) || 0) - (Number(new Date(a.last)) || Number(a.last) || 0));
}

/** 讀一個聊天檔（整個陣列，第一筆通常是聊天資訊和 chat_metadata）。 */
export async function loadOldChat(id) {
    const c = ctx();
    const ch = c?.characters?.[c.characterId];
    const data = await post('/api/chats/get', { ch_name: ch?.name ?? c?.name2 ?? '', file_name: id, avatar_url: characterKey() });
    if (!Array.isArray(data) || !data.length) throw new Error('empty chat');
    return data;
}

/** Horae 記的故事日期（格式很亂：2025/12/14 08:42（星期日）、2026/9/14 (一)）。 */
function horaeDate(m) {
    const s = (m?.horae_meta ?? m?.extra?.horae_meta)?.timestamp?.story_date;
    const x = String(s ?? '').match(/(\d{4})\s*[/\-年.]\s*(\d{1,2})\s*[/\-月.]\s*(\d{1,2})/);
    return x ? normDate(`${x[1]}-${x[2].padStart(2, '0')}-${x[3].padStart(2, '0')}`) : '';
}

// ===== 從標籤或文字找日期（v0.13.44，使用者回報：沒摘要過、也沒用 Horae 的聊天，493 層全部「沒有日期」） =====
// 很多卡會在狀態欄（例如 <status>…日期：2025年10月21日…</status>）或純文字的「日期：…」寫故事日期。
// 自動：先抽樣沒有日期的 AI 樓層，找哪個標籤裡最常讀得到完整的日期；沒有的話試試純文字的「日期：…」那一行。
// 只有「月日」沒有年的，用上一個日期的年份。使用者可以改用別的標籤，或不用。

const FULL_DATE = /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/;
const MONTH_DAY = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日號号]/;
const WHEN_LINE = /^\s*[-*•·]?\s*[【\[]?\s*(?:時間|时间|日期|時段|时段|日子|time|date|datetime)\s*[】\]]?\s*[:：]/i;
/** 抽樣幾則來找日期在哪裡；讀到完整日期的比例至少多少才採用。 */
const DATE_SAMPLE = 400;
const DATE_MIN_RATE = 0.3;

const pad = (x) => String(x).padStart(2, '0');

function parseDate(text, year = '') {
    const s = String(text ?? '');
    const m = s.match(FULL_DATE);
    if (m) return normDate(`${m[1]}-${pad(m[2])}-${pad(m[3])}`);
    const x = year ? s.match(MONTH_DAY) : null;
    return x ? normDate(`${year}-${pad(x[1])}-${pad(x[2])}`) : '';
}

function tagInner(text, tag) {
    const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = String(text ?? '').match(new RegExp(`<\\s*${esc}(?:\\s[^<>]*)?>([\\s\\S]*?)<\\s*\\/\\s*${esc}\\s*>`, 'i'));
    return m ? m[1] : '';
}

/** 純文字的「日期：…」「時間：…」那一行（只看前後各 12 行）。 */
function textDate(text, year) {
    const lines = String(text ?? '').split(/\r?\n/);
    const near = lines.length > 24 ? [...lines.slice(0, 12), ...lines.slice(-12)] : lines;
    for (const line of near) {
        if (line.length > 120 || !WHEN_LINE.test(line)) continue;
        const d = parseDate(line, year);
        if (d) return d;
    }
    return '';
}

/** 這一則用 dates（{ mode: 'tag'|'text'|'none', tag }）讀到的日期。 */
function extraDate(mes, dates, year) {
    if (dates?.mode === 'tag' && dates.tag) return parseDate(tagInner(mes, dates.tag), year);
    if (dates?.mode === 'text') return textDate(mes, year);
    return '';
}

/**
 * 找日期在哪裡：{ mode, tag, candidates: [{ tag, hits }], text: 純文字讀得到的則數, sample }。
 * 只看沒有戀人手帳日期、也沒有 Horae 日期的 AI 樓層。
 */
export function detectDates(loaded) {
    const pool = [];
    for (const { data } of loaded) {
        const header = data[0] && !('mes' in data[0]) ? data[0] : null;
        for (const m of header ? data.slice(1) : data) {
            if (!isAiMessage(m) || normDate(m.extra?.[MODULE]?.date) || horaeDate(m)) continue;
            pool.push(String(m.mes ?? ''));
        }
    }
    if (!pool.length) return { mode: 'none', tag: '', candidates: [], text: 0, sample: 0 };
    const step = Math.max(1, Math.floor(pool.length / DATE_SAMPLE));
    const sample = pool.filter((_, i) => i % step === 0).slice(0, DATE_SAMPLE);
    const candidates = scanTags(sample)
        .filter((x) => x.dated)
        .map((x) => ({ tag: x.name, hits: sample.filter((m) => parseDate(tagInner(m, x.name))).length }))
        .filter((x) => x.hits)
        .sort((a, b) => b.hits - a.hits);
    const text = sample.filter((m) => textDate(m)).length;
    const min = sample.length * DATE_MIN_RATE;
    if (candidates[0] && candidates[0].hits >= min && candidates[0].hits >= text) return { mode: 'tag', tag: candidates[0].tag, candidates, text, sample: sample.length };
    if (text >= min) return { mode: 'text', tag: '', candidates, text, sample: sample.length };
    return { mode: 'none', tag: '', candidates, text, sample: sample.length };
}

const EVENT_TYPES = ['period', 'intimacy', 'anniversary'];

function plainEvent(ev, date, origin) {
    return {
        type: ev.type,
        date,
        ...(ev.title ? { title: String(ev.title) } : {}),
        ...(ev.state ? { state: ev.state } : {}),
        ...(ev.count ? { count: Number(ev.count) || 1 } : {}),
        origin,
    };
}

/**
 * 分析讀到的聊天（照勾選的順序，舊的先）。
 * loaded：[{ id, data }]。回傳 { chats, days, totals, calendar, overlaps }。
 * keepDays：false 時不換掉「上次讀到的每一天」（只是來讀行事曆的，不影響寫日記，v0.13.38）。
 * dates：日期從哪裡讀（detectDates 的結果，或使用者選的 { mode, tag }）；沒給就自動找。
 */
export function analyzeChats(loaded, { keepDays = true, dates = detectDates(loaded) } = {}) {
    const seen = new Set();
    const days = new Map();
    const day = (date) => {
        if (!days.has(date)) days.set(date, { date, ai: 0, user: 0, summarized: 0, coarse: 0, side: 0, rawChars: 0, sumChars: 0, chats: new Set(), units: [], sendChars: 0 });
        return days.get(date);
    };
    const totals = { ai: 0, summarized: 0, unsummarized: 0, undated: 0, skipped: 0, side: 0, duplicates: 0, horae: 0, found: 0 };
    const events = [];
    const chats = [];
    for (const { id, data } of loaded) {
        const header = data[0] && !('mes' in data[0]) ? data[0] : null;
        const messages = header ? data.slice(1) : data;
        const meta = header?.chat_metadata?.[MODULE] ?? {};
        const removed = new Set(meta.calendar?.removed ?? []);
        const info = { id, ai: 0, firstDate: '', lastDate: '' };
        let cur = '';
        // 使用者發言先放著，算進下一層 AI 回覆的那一天（v0.13.36：以前算進前一天，新的一天開頭那句會跑到昨天的日記）。
        let waiting = [];
        const flush = () => {
            const d = day(cur);
            for (const u of waiting) {
                d.user++;
                d.rawChars += u.text.length;
                d.units.push(u);
                d.sendChars += u.text.length;
            }
            waiting = [];
        };
        for (const m of messages) {
            if (!isAiMessage(m) && !isUserMessage(m)) continue;
            const key = `${m.send_date ?? ''}|${hashText(m.mes ?? '')}`;
            if (seen.has(key)) {
                if (isAiMessage(m)) totals.duplicates++;
                continue;
            }
            seen.add(key);
            const e = m.extra?.[MODULE];
            if (isAiMessage(m)) {
                const own = normDate(e?.date);
                const h = own ? '' : horaeDate(m);
                const found = own || h ? '' : extraDate(m.mes, dates, cur.slice(0, 4));
                if (own || h || found) cur = own || h || found;
                if (!own && h) totals.horae++;
                if (found) totals.found++;
            }
            const text = cleanForSummary(m.mes ?? '');
            const raw = text.length;
            if (isUserMessage(m)) {
                waiting.push({ ai: false, name: m.name ?? '', text, chat: id });
                continue;
            }
            flush();
            const d = day(cur);
            info.ai++;
            totals.ai++;
            if (cur) {
                if (!info.firstDate || cur < info.firstDate) info.firstDate = cur;
                if (!info.lastDate || cur > info.lastDate) info.lastDate = cur;
            } else totals.undated++;
            if (e?.status === 'skip') {
                totals.skipped++;
                continue;
            }
            if (e?.status === 'side') {
                totals.side++;
                d.side++;
                continue;
            }
            d.ai++;
            d.rawChars += raw;
            d.chats.add(id);
            // 寫日記用：有單層摘要（不是粗略補建）就用摘要，沒有就用原文。
            const time = e?.time || (m?.horae_meta ?? m?.extra?.horae_meta)?.timestamp?.story_time || '';
            const summary = e?.status === 'ok' && !e.coarse && e.summary ? String(e.summary) : '';
            d.units.push({ ai: true, name: m.name ?? '', text, summary, time: String(time), chat: id });
            d.sendChars += summary ? summary.length : raw;
            if (e?.status === 'ok' && (e.summary || e.coarse)) {
                d.summarized++;
                totals.summarized++;
                if (e.coarse) d.coarse++;
                d.sumChars += String(e.summary ?? '').length;
            } else totals.unsummarized++;
            (Array.isArray(e?.events) ? e.events : []).forEach((ev, k) => {
                if (!EVENT_TYPES.includes(ev?.type)) return;
                const evKey = `${m.send_date ?? ''}#${k}`;
                if (removed.has(evKey)) return;
                const date = ev.type === 'anniversary' ? String(ev.date ?? '') : cur;
                if (!date) return;
                events.push(plainEvent(ev, date, `${id}#${evKey}`));
            });
        }
        flush();
        for (const ev of meta.calendar?.manual ?? []) {
            if (EVENT_TYPES.includes(ev?.type) && ev.date) events.push(plainEvent(ev, ev.date, `${id}#${ev.id}`));
        }
        for (const ev of meta.calendar?.carried ?? []) if (EVENT_TYPES.includes(ev?.type) && ev.origin) events.push({ ...ev });
        chats.push(info);
    }
    if (keepDays) lastUnits = new Map([...days.values()].map((d) => [d.date, d.units]));
    const list = [...days.values()]
        .filter((d) => d.ai || d.side)
        .map((d) => {
            const parts = Math.max(1, Math.ceil(d.ai / PART_FLOORS));
            const per = d.ai ? Math.ceil(d.ai / parts) : 0;
            const diary = d.ai ? parts * Math.max(DIARY_MIN, Math.min(DIARY_MAX, per * DIARY_PER_FLOOR)) : 0;
            return { date: d.date, ai: d.ai, user: d.user, summarized: d.summarized, coarse: d.coarse, side: d.side, rawChars: d.rawChars, sumChars: d.sumChars, sendChars: d.sendChars, parts, diary, chats: [...d.chats] };
        })
        .sort((a, b) => (a.date ? (b.date ? a.date.localeCompare(b.date) : -1) : 1));
    // 同一個 origin 只留一筆（帶來帶去的）。
    const byOrigin = new Map();
    for (const ev of events) if (!byOrigin.has(ev.origin)) byOrigin.set(ev.origin, ev);
    const calendar = [...byOrigin.values()];
    return {
        chats,
        days: list,
        totals: { ...totals, days: list.filter((d) => d.date && d.ai).length, diary: list.reduce((n, d) => n + d.diary, 0), raw: list.reduce((n, d) => n + d.rawChars, 0) },
        calendar: {
            items: calendar,
            period: calendar.filter((x) => x.type === 'period' && x.state === 'start').length,
            intimacy: calendar.filter((x) => x.type === 'intimacy').reduce((n, x) => n + (Number(x.count) || 1), 0),
            anniversary: calendar.filter((x) => x.type === 'anniversary').length,
        },
        dates,
        // 同一天有好幾個聊天都寫到（可能是 IF 線、平行世界）。
        overlaps: list.filter((d) => d.date && d.chats.length > 1).map((d) => d.date),
    };
}
