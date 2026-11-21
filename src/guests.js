// 🏨 客人簿（v0.13.63，使用者要求）：經營類的卡（開酒館、開店…）來來去去的客人，一人一條。
//
// - 每個聊天自己開（存在 chat_metadata.lovers_planner.guests），欄位自己定；不跨聊天帶走。
// - 客人是記事的一種（type: 'guest'），所以重播、撤銷、重做、手動編輯都沿用記事那一套（notes.js）。
// - 欄位用內部的 key（g_xxxx）存資料；給模型看、讓模型回報時用「欄位名稱」，改名不會弄丟舊資料。
//   刪掉的欄位只是關掉（off），舊資料照樣顯示得出名稱。
// - 退房：complete（result: left）→「已離開」；以前的客人又來了：同一條重新打開，來訪次數 +1，上一次住的經過留在 stays。

import { ctx, MODULE } from './util.js';
import { currentLocale, t } from './i18n.js';

/** 名字一定有，當標題、也用來認「是不是同一個人」。 */
export const GUEST_TITLE = 'name';

const MAX_FIELDS = 20;
const MAX_LABEL = 12;
const MAX_HINT = 60;

// 「經營酒館」範本：使用者要記的是住哪間、要什麼服務、點了什麼、付了多少、欠多少。
const TEMPLATE = {
    'zh-TW': [
        ['身分', '種族、職業、從哪裡來'],
        ['同行', '一起來的人（名字或「護衛 3 人」）'],
        ['入住', '哪天、什麼時候住進來（照故事裡的時間）'],
        ['退房', '哪天、什麼時候走的'],
        ['房間', '住哪一間、幾個床位'],
        ['服務', '要了什麼服務（熱水、餵馬、特別服務…）'],
        ['點餐', '點了什麼吃的喝的'],
        ['已付', '付了多少錢（寫數字和單位）'],
        ['欠款', '還欠多少（付清了就寫 0）'],
        ['印象', '這個客人的特點、和老闆之間發生的事，40 字內'],
    ],
    'zh-CN': [
        ['身份', '种族、职业、从哪里来'],
        ['同行', '一起来的人（名字或「护卫 3 人」）'],
        ['入住', '哪天、什么时候住进来（照故事里的时间）'],
        ['退房', '哪天、什么时候走的'],
        ['房间', '住哪一间、几个床位'],
        ['服务', '要了什么服务（热水、喂马、特别服务…）'],
        ['点餐', '点了什么吃的喝的'],
        ['已付', '付了多少钱（写数字和单位）'],
        ['欠款', '还欠多少（付清了就写 0）'],
        ['印象', '这个客人的特点、和老板之间发生的事，40 字内'],
    ],
    en: [
        ['Who', 'race, job, where from'],
        ['Party', 'who came with them (names or "3 guards")'],
        ['Check-in', 'when they arrived (story time)'],
        ['Check-out', 'when they left'],
        ['Room', 'which room, how many beds'],
        ['Services', 'services asked for (hot water, stabling, special service…)'],
        ['Orders', 'food and drink ordered'],
        ['Paid', 'how much they paid (number and unit)'],
        ['Owes', 'how much they still owe (0 when settled)'],
        ['Notes', 'what stands out about them, what happened with the owner, under 40 words'],
    ],
};

function record(create) {
    const meta = ctx()?.chatMetadata;
    if (!meta) return null;
    if (!meta[MODULE] && create) meta[MODULE] = {};
    return meta[MODULE] ?? null;
}

function save() {
    const c = ctx();
    try {
        if (typeof c?.saveMetadataDebounced === 'function') c.saveMetadataDebounced();
        else c?.saveMetadata?.();
    } catch (e) { /* 忽略 */ }
}

function newKey(used) {
    for (;;) {
        const k = `g_${Math.random().toString(36).slice(2, 6)}`;
        if (!used.has(k)) return k;
    }
}

const clip = (s, n) => String(s ?? '').trim().slice(0, n);

/** 這個聊天的客人簿設定（沒開過是 null）。 */
export function guestBook() {
    const g = record(false)?.guests;
    return g && typeof g === 'object' ? g : null;
}

export function guestOn() {
    return Boolean(guestBook()?.on);
}

/** 客人簿的名字（分頁標題）。 */
export function guestTitle() {
    return guestBook()?.title || t('tab.guests');
}

/** 在住的客人要不要送給角色（卡自己有在住客人的，可以關掉，只送離開了又被提到的）。預設送。 */
export function guestSendActive() {
    return guestBook()?.sendActive !== false;
}

/** 欄位設定：[{ k, label, hint, off? }]（不含名字）。all：連關掉的也要（顯示舊資料的名稱用）。 */
export function guestFields({ all = false } = {}) {
    const list = Array.isArray(guestBook()?.fields) ? guestBook().fields : [];
    return all ? list : list.filter((f) => !f.off);
}

/** 給模型填、表單上顯示的欄位 key（名字在最前面）。 */
export function guestFieldKeys() {
    return [GUEST_TITLE, ...guestFields().map((f) => f.k)];
}

/** 欄位名稱（關掉的欄位也找得到；找不到就顯示 key）。 */
export function guestLabel(k) {
    if (k === GUEST_TITLE) return t('field.guest.name');
    return guestFields({ all: true }).find((f) => f.k === k)?.label || k;
}

/**
 * 模型（或匯入）用欄位名稱當 key 寫的資料，換成內部的 key。
 * 認得：內部 key、欄位名稱、「名字／name」。認不得的丟掉。
 */
export function guestData(data) {
    const out = {};
    if (!data || typeof data !== 'object') return out;
    const fields = guestFields({ all: true });
    const byLabel = new Map(fields.map((f) => [String(f.label).trim().toLowerCase(), f.k]));
    const keys = new Set(fields.map((f) => f.k));
    const names = new Set([GUEST_TITLE, t('field.guest.name').toLowerCase(), '名字', '姓名', 'name']);
    for (const [raw, v] of Object.entries(data)) {
        const key = String(raw).trim();
        const low = key.toLowerCase();
        const k = names.has(low) ? GUEST_TITLE : keys.has(key) ? key : byLabel.get(low);
        if (k && !(k in out)) out[k] = v;
    }
    return out;
}

function store(next) {
    const rec = record(true);
    if (!rec) return false;
    rec.guests = next;
    save();
    return true;
}

/** 改客人簿的設定（on／title／sendActive）。第一次打開且還沒有欄位時，套用範本。 */
export function setGuestBook(patch) {
    const cur = guestBook() ?? { on: false, title: '', fields: [], sendActive: true };
    const next = { ...cur, ...patch };
    if (patch.title !== undefined) next.title = clip(patch.title, 20);
    if (next.on && !cur.fields?.length && !patch.fields) next.fields = templateFields([]);
    return store(next);
}

/** 範本的欄位（已經有同名欄位的不重複加）。 */
function templateFields(existing) {
    const used = new Set(existing.map((f) => f.k));
    const names = new Set(existing.filter((f) => !f.off).map((f) => f.label));
    const out = [...existing];
    for (const [label, hint] of TEMPLATE[currentLocale()] ?? TEMPLATE.en) {
        if (names.has(label)) continue;
        // 以前關掉的同名欄位：打開回來，舊資料接得上。
        const old = out.find((f) => f.off && f.label === label);
        if (old) { old.off = false; continue; }
        const k = newKey(used);
        used.add(k);
        out.push({ k, label, hint });
    }
    return out.slice(0, MAX_FIELDS + out.filter((f) => f.off).length);
}

/** 一鍵套用「經營酒館」範本（補上還沒有的欄位）。 */
export function applyGuestTemplate() {
    const cur = guestBook() ?? { on: true, title: '', fields: [], sendActive: true };
    return store({ ...cur, fields: templateFields(guestFields({ all: true }).map((f) => ({ ...f }))) });
}

export function addGuestField(label = '', hint = '') {
    const cur = guestBook();
    if (!cur) return false;
    const all = guestFields({ all: true }).map((f) => ({ ...f }));
    if (guestFields().length >= MAX_FIELDS) return false;
    const k = newKey(new Set(all.map((f) => f.k)));
    return store({ ...cur, fields: [...all, { k, label: clip(label, MAX_LABEL) || t('guest.newField'), hint: clip(hint, MAX_HINT) }] });
}

/** 改欄位的名稱或說明（資料用 key 存，改名不會弄丟）。 */
export function updateGuestField(k, { label, hint } = {}) {
    const cur = guestBook();
    if (!cur) return false;
    const fields = guestFields({ all: true }).map((f) => (f.k !== k ? f : {
        ...f,
        ...(label !== undefined && clip(label, MAX_LABEL) ? { label: clip(label, MAX_LABEL) } : {}),
        ...(hint !== undefined ? { hint: clip(hint, MAX_HINT) } : {}),
    }));
    return store({ ...cur, fields });
}

/** 刪掉欄位：只是關掉，已經記下的資料照樣顯示、照樣有名稱。 */
export function removeGuestField(k) {
    const cur = guestBook();
    if (!cur) return false;
    return store({ ...cur, fields: guestFields({ all: true }).map((f) => (f.k === k ? { ...f, off: true } : f)) });
}

/** 往上／往下移一格（只算開著的欄位）。 */
export function moveGuestField(k, delta) {
    const cur = guestBook();
    if (!cur) return false;
    const all = guestFields({ all: true }).map((f) => ({ ...f }));
    const live = all.filter((f) => !f.off);
    const i = live.findIndex((f) => f.k === k);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= live.length) return false;
    [live[i], live[j]] = [live[j], live[i]];
    return store({ ...cur, fields: [...live, ...all.filter((f) => f.off)] });
}

/** 名字（含「同行」這種不算）有沒有出現在一段文字裡。兩個字以上才算，免得單字誤中。 */
export function guestMentioned(note, text) {
    const name = String(note?.data?.[GUEST_TITLE] ?? '').trim().toLowerCase();
    if (name.length < 2 || !text) return false;
    const low = text.toLowerCase();
    if (low.includes(name)) return true;
    // 「奧托·鐵砧」這種：名字的第一段（兩個字以上）也算。
    const head = name.split(/[·・\s]/)[0];
    return head.length >= 2 && head !== name && low.includes(head);
}
