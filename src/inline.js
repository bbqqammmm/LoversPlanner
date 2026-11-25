// 主模型順手寫（設定 › 摘要 › 模式 'inline'，v0.13.67，使用者要求）
//
// 不另外呼叫模型：生成時在提示詞最後（深度 0）加一段說明，請主模型寫完正文後，
// 在回覆最後附一段紀錄（用 HTML 註解包起來：酒館不會顯示註解，串流時也看不到）。
// 回覆完成時把那段拆出來，照單層摘要的格式存成這一層的摘要，再從正文裡拿掉
// （正文乾淨，下一輪也不會被送回去）。每個 swipe 各記各的。
//
// 主模型沒寫、或寫壞：這一層標成失敗，跳通知讓使用者自己按「另外摘要」（不自動多花一次呼叫）。
// L2／L3 壓縮、日記這些照舊另外呼叫。

import { ctx, LOG_PREFIX, MODULE, toast, toastActions } from './util.js';
import { getSettings } from './settings.js';
import { currentLocale, t } from './i18n.js';
import { buildL1Parts } from './l1rules.js';
import { replay } from './notes.js';
import { errorText } from './errors.js';
import { noteError } from './errlog.js';
import { floorSource, getChat, getEntry, isAiMessage, saveChatSoon } from './chat.js';
import {
    applyL1Result, enqueue, isActive, markL1Fail, notesSection, parseL1, previousDate, previousSceneText,
} from './summarize.js';

export const TAG = 'lovers_planner';
const KEY = `${MODULE}_inline`;
/** 酒館的 extension_prompt_types／roles（和 hide.js 一樣照原始碼的數值）。 */
const IN_CHAT = 1;
const ROLE_SYSTEM = 0;
/** 這幾種生成不加說明：背景的安靜生成（別的擴充）、代替使用者發言。 */
const NO_INLINE_TYPES = new Set(['quiet', 'impersonate']);

// 認得兩種寫法：說明裡要的 HTML 註解 <!--lovers_planner … -->，和模型自己改成的標籤 <lovers_planner>…</lovers_planner>。
// 沒收尾的（回覆被截斷）也認，拿到最後。
const BLOCKS = [
    new RegExp(`<!--\\s*${TAG}\\b([\\s\\S]*?)(?:-->|$)`, 'i'),
    new RegExp(`<${TAG}>([\\s\\S]*?)(?:</${TAG}>|$)`, 'i'),
];

export function inlineOn() {
    return isActive() && getSettings().summary.mode === 'inline';
}

/** 從回覆裡拆出紀錄：{ inner, rest }；沒有就是 null。 */
export function extractInline(text) {
    const src = String(text ?? '');
    let best = null;
    for (const re of BLOCKS) {
        const m = src.match(re);
        if (m && (best === null || m.index < best.index)) best = m;
    }
    if (!best) return null;
    const inner = best[1].replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const rest = (src.slice(0, best.index) + src.slice(best.index + best[0].length))
        .replace(/```(?:\w+)?\s*```/g, '') // 模型把整段包在 ``` 裡：拆掉後剩下空的框
        .replace(/\n{3,}/g, '\n\n')
        .trimEnd();
    return { inner, rest };
}

/** 這一段紀錄大概寫多長：還不知道回覆多長，用設定的最低／最高 token 的中間值換算成字數。 */
function inlineLength() {
    const s = getSettings().summary;
    const mid = (Number(s.minTokens) + Number(s.maxTokens)) / 2 || 90;
    const perToken = currentLocale().startsWith('zh') ? 1.3 : 0.75;
    return Math.max(10, Math.round((mid * perToken) / 10) * 10);
}

/** 給主模型的說明：寫法、上一層的時間地點、目前的記事、格式（和單層摘要同一份規則）。 */
export function inlineInstruction() {
    const c = ctx();
    const index = getChat().length; // 下一則回覆會在這裡
    const { rules, format } = buildL1Parts({
        length: inlineLength(), char: c?.name2 ?? '', user: c?.name1 ?? '', previousDate: previousDate(index),
    });
    return t('inline.instruction', {
        tag: TAG,
        rules,
        previous: previousSceneText(index),
        notes: notesSection(replay({ upTo: index }).notes),
        format,
    }).replace(/\n{3,}/g, '\n\n');
}

function setPrompt(text) {
    try {
        ctx()?.setExtensionPrompt?.(KEY, text, IN_CHAT, 0, false, ROLE_SYSTEM);
    } catch (e) {
        console.warn(LOG_PREFIX, '設定順手寫的說明失敗', e);
    }
}

export function clearInlinePrompt() {
    setPrompt('');
}

/** 攔截器每次生成都叫：順手寫模式就放說明（最後面），不然清掉。 */
export function prepareInline(type) {
    if (!inlineOn() || NO_INLINE_TYPES.has(type)) {
        clearInlinePrompt();
        return;
    }
    try {
        setPrompt(inlineInstruction());
    } catch (e) {
        console.warn(LOG_PREFIX, '組順手寫的說明失敗', e);
        clearInlinePrompt();
    }
}

/** 正文改了：重新顯示這一則（拿掉紀錄之後）。 */
function rerender(index) {
    const c = ctx();
    const msg = getChat()[index];
    try {
        if (typeof c?.updateMessageBlock === 'function') {
            c.updateMessageBlock(index, msg);
            return;
        }
    } catch (e) {
        console.warn(LOG_PREFIX, '重新顯示訊息失敗', e);
    }
    try {
        const el = document.querySelector(`#chat .mes[mesid="${index}"] .mes_text`);
        if (el && typeof c?.messageFormatting === 'function') el.innerHTML = c.messageFormatting(msg.mes, msg.name, false, false, index);
    } catch { /* 顯示不了就等酒館自己重畫 */ }
}

function missingToast(index, message) {
    toastActions(t('inline.missing', { n: index, error: message }), [{
        label: t('inline.summarizeNow'),
        primary: true,
        run: () => enqueue(index, { front: true }),
    }], { type: 'warning', timeOut: 0 });
}

/** 回覆完成（新回覆、重新生成、swipe、繼續寫都會觸發）：拆出紀錄存起來。 */
export function onInlineReceived(id) {
    if (!inlineOn()) return;
    const chat = getChat();
    const index = Number.isInteger(id) ? id : chat.length - 1;
    const msg = chat[index];
    if (!isAiMessage(msg)) return;
    const got = extractInline(msg.mes);
    if (got) {
        msg.mes = got.rest;
        const k = msg.swipe_id ?? 0;
        if (Array.isArray(msg.swipes) && k < msg.swipes.length) msg.swipes[k] = got.rest;
        setTimeout(() => rerender(index), 0);
    }
    const hash = floorSource(index).hash;
    const prev = getEntry(index);
    if (!got) {
        // 「繼續寫」接長了、這次沒附紀錄：原本的摘要留著（會顯示過期），讓她決定要不要重摘。
        if (prev?.status === 'ok') {
            if (prev.hash !== hash) missingToast(index, t('inline.notWritten'));
            return;
        }
        markL1Fail(index, t('inline.notWritten'), hash);
        saveChatSoon();
        missingToast(index, t('inline.notWritten'));
        return;
    }
    try {
        const parsed = parseL1(got.inner);
        applyL1Result(index, parsed, { notesBefore: replay({ upTo: index }).notes, hash, by: t('inline.by') });
        if (parsed.repaired) toast(t('inline.repaired', { n: index }), 'warning');
    } catch (e) {
        noteError('inline', e, {});
        console.warn(LOG_PREFIX, `第 ${index} 層順手寫的紀錄看不懂`, e);
        const message = errorText(e);
        markL1Fail(index, message, hash);
        missingToast(index, message);
    }
    saveChatSoon();
}

/** 已經畫出來的那一則：串流結束時酒館用的是串流的文字，拆掉紀錄後要再畫一次。 */
function onRendered(id) {
    if (!inlineOn()) return;
    const index = Number.isInteger(id) ? id : getChat().length - 1;
    const msg = getChat()[index];
    const el = document.querySelector(`#chat .mes[mesid="${index}"] .mes_text`);
    if (msg && el && el.textContent.includes(TAG)) rerender(index);
}

export function initInline() {
    const c = ctx();
    if (!c?.eventSource || !c.eventTypes) return;
    const ev = c.eventTypes;
    c.eventSource.on(ev.MESSAGE_RECEIVED, onInlineReceived);
    if (ev.CHARACTER_MESSAGE_RENDERED) c.eventSource.on(ev.CHARACTER_MESSAGE_RENDERED, onRendered);
    // 換成別的模式、關掉擴充：說明不要留著
    c.eventSource.on(ev.CHAT_CHANGED, () => { if (!inlineOn()) clearInlinePrompt(); });
}
