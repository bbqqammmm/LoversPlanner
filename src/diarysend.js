// 📖 日記送給角色（v0.13.36，日記第三階段）：
//   最近幾天（照故事日期，預設 3 天）送全文；更早的平常不送，聊到相關的事時找回那一段（recall.js）；
//   另外送一段很短的大綱（diary.js 寫的）。
//   「最近」以現在這個聊天的故事日期為準（最新一個有日期的 AI 樓層）；這個聊天還沒有日期就用日記的最後一天。
//   壓縮過的日子用壓縮版，找回時整天算一段；沒壓縮的照寫日記時的分段。

import { getSettings } from './settings.js';
import { getChat, getEntry, isAiMessage } from './chat.js';
import { addDays, normDate } from './calendar.js';
import { dayText, diaryOutline, listDiary } from './diary.js';

export function diarySendOn() {
    return getSettings().diary?.send !== false;
}

/** 現在的故事日期：這個聊天最新一個有日期的 AI 樓層；沒有就用日記的最後一天。 */
export function anchorDate(list = listDiary()) {
    const chat = getChat();
    for (let i = chat.length - 1; i >= 0; i--) {
        if (!isAiMessage(chat[i])) continue;
        const d = normDate(getEntry(i)?.date);
        if (d) return d;
    }
    const dated = list.filter((d) => d.date && d.chars);
    return dated.length ? dated[dated.length - 1].date : '';
}

function label(date, part = 0, total = 1) {
    return `【${date || '—'}${total > 1 ? ` ${part}/${total}` : ''}】`;
}

/**
 * 要送的日記：{ anchor, from, outline, recent: [{ date, line }], older: [{ key, date, part, total, line, location }] }。
 * recent 是最近幾天的全文；older 是更早的，給 recall.js 挑。from：最近的從哪一天算起（沒有最近的時是 ''）。
 */
export function diaryPlan() {
    const empty = { anchor: '', from: '', outline: '', recent: [], older: [] };
    if (!diarySendOn()) return empty;
    const list = listDiary().filter((d) => d.chars);
    const outline = diaryOutline()?.text ?? '';
    if (!list.length) return { ...empty, outline };
    const n = Math.max(0, Math.floor(Number(getSettings().diary?.recentDays) || 0));
    const anchor = anchorDate(list);
    const from = anchor && n ? addDays(anchor, -(n - 1)) : '';
    const recent = [];
    const older = [];
    for (const d of list) {
        if (from && d.date && d.date >= from) {
            recent.push({ date: d.date, line: `${label(d.date)}${dayText(d)}` });
            continue;
        }
        const location = d.parts.find((p) => p?.location)?.location ?? '';
        if (d.use === 'compressed') {
            older.push({ key: `${d.date}#c`, date: d.date, part: 0, total: 1, line: `${label(d.date)}${d.compressed.summary}`, location });
            continue;
        }
        const parts = d.parts.filter((p) => p?.summary);
        parts.forEach((p, k) => older.push({
            key: `${d.date}#${p.part ?? k + 1}`, date: d.date, part: p.part ?? k + 1, total: parts.length,
            line: `${label(d.date, p.part ?? k + 1, parts.length)}${p.summary}`, location: p.location || location,
        }));
    }
    return { anchor, from, outline, recent, older };
}
