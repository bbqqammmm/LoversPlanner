// TauriTavern 的增強 API（v0.13.55，使用者找到的 TT 文件：給記憶類擴充用的 api.chat）。
//
// 只讀別的聊天的聊天資料（chat_metadata），不用把整個聊天檔載進來（聊天檔常常十幾 MB，iPhone 上讀很慢）。
// 不是 TT、API 不在、或格式和預期不同：回傳 undefined，呼叫的人改用酒館的 /api/chats/get 讀整個檔。
// ChatRef 的 characterId 是什麼格式文件沒寫，所以拿目前聊天的 ref 只換檔名（同一個角色的聊天才用得到）。

import { LOG_PREFIX } from './util.js';

function chatApi() {
    return globalThis.__TAURITAVERN__?.api?.chat ?? null;
}

/** 這個環境有沒有 TT 的聊天 API。 */
export function hasTtChatApi() {
    const api = chatApi();
    return Boolean(api?.open && api.current?.ref);
}

/** 同一個角色的另一個聊天（檔名，不含 .jsonl）的 chat_metadata；拿不到回傳 undefined。 */
export async function otherChatMetadata(fileName) {
    const api = chatApi();
    if (!fileName || !api?.open || !api.current?.ref) return undefined;
    try {
        await (globalThis.__TAURITAVERN__?.ready ?? globalThis.__TAURITAVERN_MAIN_READY__);
        const cur = api.current.ref();
        if (cur?.kind !== 'character' || !cur.fileName) return undefined;
        const name = /\.jsonl$/i.test(cur.fileName) ? `${fileName}.jsonl` : fileName;
        const handle = await api.open({ ...cur, fileName: name });
        const s = await handle?.summary?.({ includeMetadata: true });
        const meta = s?.metadata ?? s?.chatMetadata ?? s?.chat_metadata;
        return meta && typeof meta === 'object' ? meta : undefined;
    } catch (e) {
        console.warn(LOG_PREFIX, 'TT 讀不到聊天資料，改讀整個聊天檔', e);
        return undefined;
    }
}

/** 等太久就放棄（搜尋不能卡住生成）。 */
function withTimeout(promise, ms) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); })]).finally(() => clearTimeout(timer));
}

/**
 * TT 的原文全文搜尋（v0.13.56）：在這些聊天裡找 query。chats 裡的 null 是目前的聊天，其他是同角色的聊天檔名。
 * 回傳 [{ chat, index, role, text, snippet, score }]；不是 TT 回傳 null。單一聊天出錯或太慢就跳過它。
 */
/** 搜過失敗的聊天：這次開著酒館的期間不再搜（每次失敗 TT 都會跳紅色提示）。 */
const failed = new Set();

export async function searchChats(query, chats, { limit = 20, timeout = 5000 } = {}) {
    const api = chatApi();
    if (!query || !api?.current?.handle) return null;
    try {
        await (globalThis.__TAURITAVERN__?.ready ?? globalThis.__TAURITAVERN_MAIN_READY__);
    } catch (e) {
        return null;
    }
    const cur = api.current.ref?.();
    const one = async (id) => {
        let handle;
        if (id === null) handle = api.current.handle();
        else {
            if (cur?.kind !== 'character' || !cur.fileName || !api.open) return [];
            handle = await api.open({ ...cur, fileName: /\.jsonl$/i.test(cur.fileName) ? `${id}.jsonl` : id });
        }
        const hits = await handle?.searchMessages?.({ query, limit });
        return (Array.isArray(hits) ? hits : []).map((h) => ({
            chat: id, index: Number(h.index), role: h.role ?? '', text: String(h.text ?? h.snippet ?? ''), snippet: String(h.snippet ?? ''), score: Number(h.score) || 0,
        })).filter((h) => Number.isInteger(h.index));
    };
    const all = await Promise.all(chats.filter((id) => id === null || !failed.has(id)).map((id) => withTimeout(one(id), timeout).catch((e) => {
        console.warn(LOG_PREFIX, 'TT 搜尋失敗，這個聊天之後不再搜', id, e);
        if (id !== null) failed.add(id);
        return [];
    })));
    return all.flat();
}
