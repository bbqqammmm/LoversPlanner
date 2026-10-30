// 🐞 錯誤報告（v0.13.46，使用者要求：出錯時一鍵複製錯誤報告，貼給 Claude 處理，不用截圖）。
//
// 只記技術資訊：什麼時候、哪個功能、錯誤碼、HTTP 狀態、服務商的錯誤說明、模型名稱、回覆多長、有沒有被截斷，
// 以及戀人手帳自己的程式錯誤（檔名和行號）。
// 不記：提示詞、模型回的內容、聊天和日記的內容、網址、API Key。服務商的錯誤說明也會拿掉網址和像 Key 的字串。
// 存在 settings.errors（最多 MAX 筆，新的在前），重新整理後還在。

import { LOG_PREFIX } from './util.js';
import { getSettings, saveSettings } from './settings.js';
import { ApiError } from './api/custom.js';
import { VERSION } from './version.js';

const MAX = 30;
const DETAIL_MAX = 200;

const listeners = new Set();
export function onErrorsChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function list() {
    const s = getSettings();
    if (!Array.isArray(s.errors)) s.errors = [];
    return s.errors;
}

/** 拿掉網址、像 Key 的字串、很長的數字串；只留前 DETAIL_MAX 字。 */
export function scrub(text) {
    return String(text ?? '')
        .replace(/https?:\/\/\S+/gi, '<url>')
        .replace(/\b(sk|pk|rk|key|token)[-_][A-Za-z0-9_-]{8,}/gi, '<key>')
        .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '<id>')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, DETAIL_MAX);
}

/**
 * 記一筆錯誤。where：哪個功能（l1、diary、backup…）；error：例外物件；
 * info：額外的技術資訊（model、replyLength、cut…），不要放內容。
 */
export function logError(where, error, info = {}) {
    try {
        const e = error ?? {};
        const isApi = e instanceof ApiError;
        const code = isApi ? e.code : (e.name && e.name !== 'Error' ? e.name : 'error');
        // parse 的 detail 是模型回的開頭（內容），不記；其他的是服務商或程式的說明，清過再記。
        const detail = isApi && e.code === 'parse' ? '' : scrub(isApi ? (e.detail ?? '') : (e.message ?? String(e)));
        const entry = {
            at: Date.now(), where: String(where || '?').slice(0, 30), code: String(code).slice(0, 40),
            ...(isApi && e.status ? { status: e.status } : {}),
            ...(detail ? { detail } : {}),
            ...Object.fromEntries(Object.entries(info).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, typeof v === 'string' ? scrub(v).slice(0, 80) : v])),
            v: VERSION,
        };
        const all = list();
        all.unshift(entry);
        if (all.length > MAX) all.length = MAX;
        saveSettings();
        for (const fn of listeners) {
            try { fn(); } catch (x) { console.error(LOG_PREFIX, x); }
        }
    } catch (x) {
        console.warn(LOG_PREFIX, '記錯誤失敗', x);
    }
}

/**
 * 功能裡接到的錯誤：呼叫模型的錯誤 llm.js 已經記過了，這裡只記讀不懂回覆（parse）和程式本身的錯誤，免得重複。
 * 錯誤上有 replyLength、cut（parseDiary／parseL1 附上的）就一起記。
 */
export function noteError(where, e, info = {}) {
    if (e instanceof ApiError && e.code !== 'parse') return;
    logError(where, e, { reply: e?.replyLength, cut: e?.cut ? 'yes' : undefined, refused: e?.refused ? 'maybe' : undefined, ...info });
}

export function listErrors() {
    return [...list()];
}

export function clearErrors() {
    getSettings().errors = [];
    saveSettings();
    for (const fn of listeners) {
        try { fn(); } catch (x) { console.error(LOG_PREFIX, x); }
    }
}

/** 執行環境（不含任何個人資料）：TauriTavern 還是 SillyTavern、系統。 */
function environment() {
    const ua = String(globalThis.navigator?.userAgent ?? '');
    const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '?';
    const host = globalThis.__TAURITAVERN__ || globalThis.__TAURITAVERN_MAIN_READY__ ? 'TauriTavern' : 'SillyTavern';
    const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : '?';
    return `${host}・${os}・${browser}`;
}

/** 模型來源的設定：用哪一種、每種工作用哪一組（只寫名字和模型，不寫網址、Key）。 */
function routing() {
    const s = getSettings();
    const name = (id) => {
        if (!id || id === 'inherit') return s.source === 'custom' ? `custom(${s.custom?.model || '?'})` : 'main';
        if (id === 'main') return 'main';
        if (id === 'custom') return `custom(${s.custom?.model || '?'})`;
        const p = (s.profiles ?? []).find((x) => x.id === id);
        return p ? `profile(${p.model || '?'})` : '?';
    };
    const routes = Object.entries(s.routes ?? {}).filter(([, v]) => v && v !== 'inherit').map(([k, v]) => `${k}→${name(v)}`);
    return [`default ${name('inherit')}`, ...routes, ...(s.fallback ? [`fallback→${name(s.fallback)}`] : [])].join(', ');
}

/** 錯誤報告的文字（給使用者複製）。limit：最多幾筆。 */
export function buildReport({ limit = 10 } = {}) {
    const rows = listErrors().slice(0, limit).map((e, k) => {
        const when = new Date(e.at).toISOString().replace('T', ' ').slice(0, 19);
        const { at, where, code, status, detail, v, ...info } = e;
        const extra = Object.entries(info).map(([key, val]) => `${key}=${val}`);
        return `${k + 1}. ${when}Z ${where} ${code}${status ? ` HTTP ${status}` : ''}${extra.length ? ` (${extra.join(', ')})` : ''}${detail ? ` — ${detail}` : ''}${v && v !== VERSION ? ` [v${v}]` : ''}`;
    });
    return [
        `Lover's Planner error report`,
        `version ${VERSION}・${environment()}`,
        `models: ${routing()}`,
        rows.length ? `errors (newest first):\n${rows.join('\n')}` : 'errors: none',
    ].join('\n');
}

/** 複製到剪貼簿；不行的話回傳 false（畫面會改成顯示文字讓使用者自己選取）。 */
export async function copyReport(text = buildReport()) {
    try {
        await globalThis.navigator.clipboard.writeText(text);
        return true;
    } catch (e) {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            return ok;
        } catch (x) {
            return false;
        }
    }
}

/** 戀人手帳自己的程式錯誤（沒被接住的）：只記檔名、行號和錯誤訊息。 */
export function initErrorLog() {
    const ours = (file) => /lovers|LoversPlanner|loversplanner/i.test(String(file ?? ''));
    const where = (stack) => {
        const m = String(stack ?? '').match(/\/(src\/[\w/]+\.js|index\.js):(\d+)/);
        return m ? `${m[1]}:${m[2]}` : '';
    };
    globalThis.addEventListener?.('error', (ev) => {
        if (!ours(ev.filename) && !ours(ev.error?.stack)) return;
        logError('code', ev.error ?? new Error(ev.message), { line: where(ev.error?.stack) || where(`${ev.filename}:${ev.lineno}`) });
    });
    globalThis.addEventListener?.('unhandledrejection', (ev) => {
        if (!ours(ev.reason?.stack)) return;
        logError('code', ev.reason, { line: where(ev.reason?.stack) });
    });
}
