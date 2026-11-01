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
