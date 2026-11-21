// 🏨 客人簿：每個聊天自己開、自訂欄位、模型用欄位名稱回報、離開→已離開、回頭客接回同一條、
// 改欄位名稱不弄丟資料、離開的客人被提到才送給角色、沒開時提示詞裡沒有客人。
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [execSync('npm root -g').toString().trim()] }));

const OUT = process.argv[2] ?? '.';
const URL = `http://127.0.0.1:${process.env.PORT ?? 8765}/tests/harness.html`;
const results = [];
const errors = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

// 虛構的小旅店：沈言和小雨經營，客人鐵叔來住、走了、又回來。
const ai = (mes) => ({ name: '沈言', is_user: false, mes, extra: {}, swipe_id: 0, swipes: [mes], swipe_info: [{ extra: {} }] });
const CHAT = [
  ai('FLOOR0 鐵叔推門進來，要了二號房，點了一壺麥酒，先付了 50 銅幣。'),
  { name: '小雨', is_user: true, mes: '歡迎光臨。', extra: {} },
  ai('FLOOR2 第二天早上鐵叔結清房錢離開了。'),
  { name: '小雨', is_user: true, mes: '路上小心。', extra: {} },
  ai('FLOOR4 過了幾天，鐵叔又來了，這次住三號房。'),
];

const MODEL = `async ({ prompt }) => {
  window.__prompts = window.__prompts || {};
  const floor = (prompt.match(/FLOOR(\\d)/) || [])[1];
  window.__prompts[floor] = prompt;
  if (floor === '0') {
    return JSON.stringify({ summary: '鐵叔住進二號房。', ops: [
      { op: 'add', type: 'guest', data: { '名字': '鐵叔', '房間': '二號房', '點餐': '麥酒', '已付': '50 銅幣', '不存在的欄位': 'x' } },
    ] });
  }
  if (floor === '2') {
    const id = prompt.match(/\\[(g_\\w+)\\] 客人/)?.[1];
    return JSON.stringify({ summary: '鐵叔離開了。', ops: [
      { op: 'complete', id, result: 'done', detail: '住了一晚，喝了麥酒，結清房錢離開。' },
    ] });
  }
  return JSON.stringify({ summary: '鐵叔又來了。', ops: [
    { op: 'add', type: 'guest', data: { '名字': '鐵叔', '房間': '三號房' } },
  ] });
}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text()); });
await page.addInitScript((chat) => { window.__chat = chat; }, CHAT);
await page.goto(URL);
await page.waitForFunction(() => document.getElementById('lp_wand_entry'));
await page.evaluate(`window.__generateRaw = ${MODEL}`);

const guests = () => page.evaluate(async () => {
  const m = await import('/src/notes.js');
  m.invalidateNotes();
  return [...m.getNotes().notes.values()].filter((n) => n.type === 'guest')
    .map((n) => ({ id: n.id, state: n.state, result: n.result, visits: n.visits ?? 1, stays: n.stays ?? [], detail: n.closedDetail, data: n.data }));
});
const label = (k) => page.evaluate(async (k) => (await import('/src/guests.js')).guestLabel(k), k);
const keyOf = (name) => page.evaluate(async (name) => (await import('/src/guests.js')).guestFields({ all: true }).find((f) => f.label === name)?.k, name);
const expand = async (i) => {
  if ((await page.getAttribute(`.mes[mesid="${i}"] .lp-sum-head`, 'aria-expanded')) !== 'true') await page.click(`.mes[mesid="${i}"] .lp-sum-head`);
};
const summarize = async (i) => {
  await expand(i);
  await page.click(`.mes[mesid="${i}"] [data-lp-act="summarize"], .mes[mesid="${i}"] [data-lp-act="redo"]`);
  await page.waitForFunction((i) => window.__chat[i].extra?.lovers_planner?.status === 'ok' && !document.querySelector(`.mes[mesid="${i}"] .lp-st-busy, .mes[mesid="${i}"] .lp-st-queued`), i);
  await page.waitForTimeout(100);
};
const openPanel = async (tab) => {
  await page.evaluate(() => { document.getElementById('extensionsMenu').style.display = ''; });
  await page.click('#lp_wand_entry');
  if (tab) await page.click(`[data-tab="${tab}"]`);
};
const closePanel = () => page.keyboard.press('Escape');

// 1. 沒開客人簿：沒有分頁、提示詞裡沒有 guest
await openPanel();
let tabs = await page.$$eval('.lp-tab', (b) => b.map((x) => x.dataset.tab).join());
check('no guests tab by default', !tabs.includes('guests'), tabs);
await page.click('[data-tab="settings"]');
const openTrack = async () => { if (!(await page.isVisible('[data-guest="on"]'))) await page.click('details[data-sec="track"] > summary'); };
await openTrack();
check('settings shows guest book switch', await page.isVisible('[data-role="guest-book"] [data-guest="on"]'));

// 2. 在設定打開：套用範本、出現分頁
await page.check('[data-guest="on"]');
await page.waitForSelector('[data-role="guest-fields"] li');
const fieldCount = await page.$$eval('[data-role="guest-fields"] li', (x) => x.length);
check('template fields applied when switched on', fieldCount === 10, String(fieldCount));
tabs = await page.$$eval('.lp-tab', (b) => b.map((x) => x.dataset.tab).join());
check('guests tab appears after items', tabs.startsWith('summary,characters,items,guests,'), tabs);
const stored = await page.evaluate(() => JSON.stringify(window.SillyTavern.getContext().chatMetadata.lovers_planner.guests.on));
check('setting stored in this chat', stored === 'true', stored);
await closePanel();

// 3. 第 0 層：模型用欄位名稱回報 → 換成內部 key；認不得的欄位丟掉
await summarize(0);
const p0 = await page.evaluate(() => window.__prompts['0']);
check('prompt explains guest fields by name', p0.includes('guest（客人簿）') && p0.includes('· 房間：住哪一間') && p0.includes('"type": "guest"'), p0.slice(p0.indexOf('guest（'), p0.indexOf('guest（') + 200));
let g = await guests();
const room = await keyOf('房間');
check('guest added with mapped fields', g.length === 1 && g[0].state === 'active' && g[0].data.name === '鐵叔' && g[0].data[room] === '二號房', JSON.stringify(g));
check('unknown field dropped', !Object.values(g[0].data).includes('x'));

// 4. 第 2 層：離開 → 已離開，記下經過
await summarize(2);
const p2 = await page.evaluate(() => window.__prompts['2']);
check('prompt lists the guest with id', /\[g_\w+\] 客人｜名字：鐵叔/.test(p2));
g = await guests();
check('guest left', g[0].state === 'done' && g[0].result === 'left' && g[0].detail.includes('結清'), JSON.stringify(g[0]));
const done = await page.evaluate(async () => (await import('/src/notes.js')).closedNotes().length);
check('left guests not in the done tab', done === 0, String(done));

// 5. 第 4 層：回頭客 → 同一條重新打開、來訪 2 次、上次的經過留著
await summarize(4);
g = await guests();
check('returning guest reuses the entry', g.length === 1 && g[0].state === 'active' && g[0].visits === 2, JSON.stringify(g));
check('past stay kept', g[0].stays.length === 1 && g[0].stays[0].detail.includes('結清') && g[0].stays[0].data[room] === '二號房', JSON.stringify(g[0].stays));
check('this visit updated', g[0].data[room] === '三號房');
const e4 = await page.evaluate(() => window.__chat[4].extra.lovers_planner.ops.map((o) => o.op).join());
check('floor ops: reopen + update', e4 === 'reopen,update', e4);
check('block shows came back', (await page.textContent('.mes[mesid="4"]')).includes('又來了'));

// 6. 大視窗：在這裡／已離開、卡片顯示來訪次數
await openPanel('guests');
check('guests tab sections', await page.isVisible('[data-role="guests-here"]') && await page.isVisible('[data-role="guests-gone"]'));
const here = await page.textContent('[data-role="guests-here"]');
check('card shows name and visits', here.includes('鐵叔') && here.includes('來過 2 次'), here.replace(/\s+/g, ' ').slice(0, 200));
await page.click('[data-role="guests-here"] .lp-row-head');
const open = await page.textContent('[data-role="guests-here"]');
check('card shows past stays', open.includes('以前來的') && open.includes('第 1 次'), open.replace(/\s+/g, ' ').slice(0, 300));
await page.screenshot({ path: `${OUT}/guests-1-tab.png` });

// 7. 手動：離開了 → 已離開；又來了 → 回來（來訪 3 次）
await page.click('[data-role="guests-here"] [data-action="note-complete"][data-result="left"]');
g = await guests();
check('manual leave', g[0].state === 'done');
const head = '[data-role="guests-gone"] .lp-row-head';
if ((await page.getAttribute(head, 'aria-expanded')) !== 'true') await page.click(head);
await page.click('[data-role="guests-gone"] [data-action="note-reopen"]');
g = await guests();
check('manual came back', g[0].state === 'active' && g[0].visits === 3, JSON.stringify(g[0]));

// 8. 改欄位名稱：資料還在，顯示新名稱
await page.click('[data-tab="settings"]');
await openTrack();
await page.fill(`[data-guest-field="label"][data-k="${room}"]`, '客房');
await page.dispatchEvent(`[data-guest-field="label"][data-k="${room}"]`, 'change');
check('renamed field keeps data', (await label(room)) === '客房' && (await guests())[0].data[room] === '三號房');
// 刪掉欄位：關掉，舊資料照樣有名稱
await page.click(`[data-action="guest-del"][data-k="${room}"]`);
check('removed field hidden from settings', !(await page.$(`[data-guest-field="label"][data-k="${room}"]`)));
check('removed field still labelled', (await label(room)) === '客房');
await page.screenshot({ path: `${OUT}/guests-2-settings.png` });
await closePanel();

// 9. 送給角色：在這裡的照樣送；關掉後只送離開了、又被提到的
const inject = () => page.evaluate(async () => (await import('/src/hide.js')).buildInjection(new Set()));
let text = await inject();
check('active guest sent', text.includes('客人｜名字：鐵叔'), text.slice(0, 300));
await page.evaluate(async () => (await import('/src/guests.js')).setGuestBook({ sendActive: false }));
text = await inject();
check('active guest not sent when switched off', !text.includes('名字：鐵叔'));
await page.evaluate(async () => {
  const n = await import('/src/notes.js');
  const id = [...n.getNotes().notes.values()].find((x) => x.type === 'guest').id;
  n.completeNoteManual(id, 'left');
});
text = await inject();
check('left guest mentioned recently is sent', text.includes('名字：鐵叔') && text.includes('已離開'), text.slice(-300));
await page.evaluate(() => { for (const m of window.__chat) m.mes = m.mes.replaceAll('鐵叔', '那位客人'); });
text = await inject();
check('left guest not mentioned is not sent', !text.includes('鐵叔'));

// 10. 關掉客人簿：提示詞裡沒有客人、分頁不見
await page.evaluate(async () => (await import('/src/guests.js')).setGuestBook({ on: false }));
await openPanel();
tabs = await page.$$eval('.lp-tab', (b) => b.map((x) => x.dataset.tab).join());
check('tab hidden when off', !tabs.includes('guests'), tabs);
const rules = await page.evaluate(async () => (await import('/src/l1rules.js')).buildL1Parts({ length: 80, char: '沈言', user: '小雨' }).rules);
check('no guest rule when off', !rules.includes('guest'));

// 11. 匯出／匯入欄位：只有欄位；匯入時加上沒有的、同名的換說明，原本的欄位不動
await page.evaluate(async () => (await import('/src/guests.js')).setGuestBook({ on: true }));
const exported = await page.evaluate(async () => (await import('/src/guests.js')).exportGuestBook());
check('export has fields only', exported.includes('lovers-planner-guestbook') && exported.includes('身分') && !exported.includes('鐵叔'), exported.slice(0, 120));
// 換成「朋友的聊天」：她有自己的一個欄位、和一個同名但說明不同的欄位
await page.evaluate(() => {
  window.SillyTavern.getContext().chatMetadata.lovers_planner.guests = { on: false, title: '', sendActive: true,
    fields: [{ k: 'g_mine', label: '身分', hint: '舊說明' }, { k: 'g_own', label: '我的欄位', hint: '' }] };
});
await closePanel();
await openPanel('settings');
await openTrack();
await page.click('[data-action="guest-import-open"]');
await page.fill('[data-role="guest-import-text"]', 'not json');
await page.click('[data-action="guest-import-do"]');
check('bad text explained, text kept', (await page.textContent('[data-role="guest-io-msg"]')).includes('讀不懂') && (await page.inputValue('[data-role="guest-import-text"]')) === 'not json');
await page.fill('[data-role="guest-import-text"]', `朋友傳來的：${exported}`);
await page.click('[data-action="guest-import-do"]');
const after = await page.evaluate(async () => (await import('/src/guests.js')).guestBook());
const labels = after.fields.filter((f) => !f.off).map((f) => f.label);
check('import turns the book on and keeps own fields first', after.on && labels[0] === '身分' && labels[1] === '我的欄位', labels.join());
check('import adds missing fields', labels.includes('同行') && labels.includes('印象') && !labels.includes('客房'), labels.join());
check('same-name field gets the new hint, same key', after.fields.find((f) => f.k === 'g_mine').hint === '種族、職業、從哪裡來');
check('import message', (await page.textContent('[data-role="guest-io-msg"]')).includes('匯入好了'));
await page.click('[data-action="guest-export"]');
await page.waitForSelector('[data-role="guest-export-text"]');
check('export box shows the text', (await page.inputValue('[data-role="guest-export-text"]')).includes('我的欄位'));
await page.screenshot({ path: `${OUT}/guests-3-io.png` });

await browser.close();
console.log(results.join('\n'));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
if (results.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
