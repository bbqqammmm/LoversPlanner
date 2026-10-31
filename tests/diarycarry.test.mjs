// 📥 日記帶到新聊天（v0.13.53，使用者要求：在窗口 7 寫了日記，開窗口 8 時日記也要在）：
// 快照記著有幾天日記；開新聊天時，摘要有帶就讀來源聊天檔把日記複製過來；復原時一起拿掉；
// 日記分頁可以手動從別的聊天帶（這裡已經有的日子不動）。v0.13.54：和摘要分開（摘要不帶也照樣帶，可以關掉）。
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [execSync('npm root -g').toString().trim()] }));

const OUT = process.argv[2] ?? '.';
const URL = `http://127.0.0.1:${process.env.PORT ?? 8765}/tests/harness.html`;
const results = [];
const errors = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const part = (summary) => ({ part: 1, total: 1, floors: 3, summary, points: [{ level: 'major', text: summary.slice(0, 6) }], time: '', location: '', at: 1, by: 'x', style: 'natural' });
const DIARY = {
  sources: ['窗口6'],
  days: {
    '2025-03-01': { date: '2025-03-01', parts: [part('在海城的咖啡店第一次見面。')], compressed: null, use: 'original', chats: ['窗口6'] },
    '2025-03-02': { date: '2025-03-02', parts: [part('一起去看海。')], compressed: null, use: 'original', chats: ['窗口6'] },
  },
  outline: { text: '三月初在海城相遇。', at: 1, by: 'x', basis: 'b' },
};
const A = [];
for (let i = 0; i < 6; i++) {
  const ai = i % 2 === 1;
  A.push({ name: ai ? '沈言' : '小雨', is_user: !ai, mes: `${ai ? 'AI' : 'U'}${i}`, send_date: `a${i}`, extra: {} });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text()); });
const reads = [];
await page.route('**/api/chats/get', (r) => {
  const { file_name } = JSON.parse(r.request().postData());
  reads.push(file_name);
  const body = file_name === '窗口7' ? [{ user_name: '小雨', character_name: '沈言', chat_metadata: { lovers_planner: { diary: DIARY } } }, ...A] : [];
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
await page.addInitScript((chat) => {
  window.__chat = chat;
  window.__chatId = '窗口7';
  window.__chatMetadata = {};
  window.__store = {};
  window.__toasts = [];
  window.toastr = { success: (m) => window.__toasts.push(m), info: (m) => window.__toasts.push(m), warning: (m) => window.__toasts.push(m), error: (m) => window.__toasts.push(m) };
  window.__presetSettings = { lovers_planner: { settingsVersion: 5, summary: { mode: 'manual' }, compress: { auto: false }, ui: { seenVersion: '9.9.9' }, backup: { auto: false } } };
}, A);
await page.goto(URL);
await page.waitForFunction(() => document.getElementById('lp_wand_entry') && globalThis.loversPlannerInterceptor);
await page.evaluate(async (diary) => {
  const { floorSource, setEntry } = await import('/src/chat.js');
  for (const i of [1, 3, 5]) setEntry(i, { v: 2, status: 'ok', summary: `第${i}層`, ops: [], hash: floorSource(i).hash, at: 1000 + i });
  SillyTavern.getContext().chatMetadata.lovers_planner = { ...(SillyTavern.getContext().chatMetadata.lovers_planner ?? {}), diary };
  // 角色的共同設定：摘要複製帶走
  const s = SillyTavern.getContext().extensionSettings.lovers_planner;
  s.characters = { 'shenyan.png': { scope: { summary: 'copy', characters: 'copy', items: 'copy', promises: 'copy', todos: 'copy', memories: 'copy' } } };
  await window.__emit('chat_id_changed');
}, DIARY);
await sleep(1800);
const snap = await page.evaluate(() => SillyTavern.getContext().extensionSettings.lovers_planner.characters['shenyan.png'].chats?.['窗口7']);
check('snapshot remembers how many diary days (not the text)', snap?.diary === 2 && !JSON.stringify(snap).includes('第一次見面'), JSON.stringify(snap).slice(0, 200));

const switchTo = (id, messages = null) => page.evaluate(async ({ id, messages }) => {
  window.__store[window.__chatId] = { chat: window.__chat, meta: window.__chatMetadata };
  const saved = window.__store[id];
  window.__chatId = id;
  window.__chat = saved?.chat ?? messages;
  window.__chatMetadata = saved?.meta ?? {};
  window.__renderChat();
  await window.__emit('chat_id_changed');
}, { id, messages });
const days = () => page.evaluate(async () => (await import('/src/diary.js')).listDiary().map((d) => d.date));

// ===== 1. 開窗口 8：自動帶 =====
await switchTo('窗口8', [{ name: '沈言', is_user: false, mes: '歡迎', send_date: 'b0', extra: {} }]);
for (let k = 0; k < 50 && !(await days()).length; k++) await sleep(100);
let d = await days();
check('new chat gets the diary', JSON.stringify(d) === '["2025-03-01","2025-03-02"]' && reads.includes('窗口7'), JSON.stringify({ d, reads }));
const extra = await page.evaluate(async () => ({ outline: (await import('/src/diary.js')).diaryOutline()?.text, carry: SillyTavern.getContext().chatMetadata.lovers_planner.carry?.diary }));
check('outline comes too; carry remembers the days', extra.outline === '三月初在海城相遇。' && extra.carry?.length === 2, JSON.stringify(extra));
check('toast says diary days came', (await page.evaluate(() => window.__toasts.join('|'))).includes('另外帶來 2 天日記'), await page.evaluate(() => window.__toasts.join('|')));
const inj = await page.evaluate(async () => (await window.__runInterceptor('normal')).injection?.value ?? '');
check('the carried diary is sent to the character', inj.includes('【以前的日記】') && inj.includes('一起去看海'), inj.slice(0, 300));

// ===== 2. 復原：日記一起拿掉（改過的留著） =====
await page.evaluate(async () => {
  const dm = await import('/src/diary.js');
  dm.editDay('2025-03-02', '一起去看海，撿了貝殼。');
  (await import('/src/carry.js')).undoCarry();
});
d = await days();
check('undo removes carried days but keeps edited ones', JSON.stringify(d) === '["2025-03-02"]', JSON.stringify(d));

// ===== 3. 手動帶：日記分頁 =====
await page.evaluate(() => { document.getElementById('extensionsMenu').style.display = ''; document.getElementById('lp_wand_entry').click(); });
await page.click('[data-tab="diary"]');
await page.waitForSelector('[data-role="diary-carry"]');
const card = await page.textContent('[data-role="diary-carry"]');
check('diary tab lists chats with diaries', card.includes('窗口7') && card.includes('2 天日記'), card.replace(/\s+/g, ' ').slice(0, 200));
await page.click('[data-action="diary-carry-toggle"]');
await page.click('[data-action="diary-carry"][data-id="窗口7"]');
await page.waitForSelector('[data-role="diary-carry-msg"]');
const msg = await page.textContent('[data-role="diary-carry-msg"]');
d = await days();
const kept = await page.evaluate(async () => (await import('/src/diary.js')).listDiary().find((x) => x.date === '2025-03-02')?.original);
check('manual bring: missing days added, existing kept', msg.includes('帶過來 1 天') && msg.includes('1 天這裡已經有了') && d.length === 2 && kept.includes('撿了貝殼'), JSON.stringify({ msg, d, kept }));
// 截圖時大視窗可能剛好自動重畫：等一下再截。
for (let k = 0; k < 3; k++) {
  try { await page.locator('[data-role="diary-carry"]').screenshot({ path: `${OUT}/diary-carry.png` }); break; } catch (e) { if (k === 2) throw e; await sleep(300); }
}

// ===== 4. 和摘要分開（v0.13.54，使用者要求：做了日記就不想帶摘要） =====
await page.evaluate(() => {
  const s = SillyTavern.getContext().extensionSettings.lovers_planner;
  s.characters['shenyan.png'].scope = { summary: 'none', characters: 'none', items: 'none', promises: 'none', todos: 'none', memories: 'none' };
  document.querySelector('[data-action="close"]')?.click();
});
await switchTo('窗口9', [{ name: '沈言', is_user: false, mes: '歡迎', send_date: 'c0', extra: {} }]);
for (let k = 0; k < 50 && !(await days()).length; k++) await sleep(100);
const nine = await page.evaluate(async () => ({ days: (await import('/src/diary.js')).listDiary().length, recap: Boolean(SillyTavern.getContext().chatMetadata.lovers_planner?.recap) }));
check('summaries not brought, diary still is', nine.days === 2 && !nine.recap, JSON.stringify(nine));
await page.evaluate(() => { SillyTavern.getContext().extensionSettings.lovers_planner.carry.diary = false; });
await switchTo('窗口10', [{ name: '沈言', is_user: false, mes: '歡迎', send_date: 'd0', extra: {} }]);
await sleep(800);
check('can be turned off', (await days()).length === 0);
await page.evaluate(() => { document.getElementById('lp_wand_entry').click(); });
await page.click('[data-tab="settings"]');
check('setting shown with memory scope', (await page.textContent('body')).includes('日記和大綱也帶過去'));

const missing = await page.evaluate(async () => (await import('/src/i18n.js')).missingKeys());
check('i18n keys complete', !missing.length, JSON.stringify(missing));
for (const l of results) console.log(l);
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
