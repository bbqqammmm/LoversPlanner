// 📦 一鍵備份全部聊天（v0.13.37）：這個角色／所有角色的聊天打包成一個檔（不打開聊天、只放有戀人手帳資料的）；
// 導入：現在開著的聊天馬上放回（先備份一份），其他聊天等打開時自動放回；角色卡的偏好跟著回來。
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [execSync('npm root -g').toString().trim()] }));

const OUT = process.argv[2] ?? '.';
const URL = `http://127.0.0.1:${process.env.PORT ?? 8765}/tests/harness.html`;
const results = [];
const errors = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

const lp = (summary) => ({ lovers_planner: { v: 2, status: 'ok', summary, ops: [], at: 1, hash: 'x' } });
const file = (tag, n, withData = true) => [
  { user_name: '小雨', character_name: '?', chat_metadata: withData ? { lovers_planner: { calendar: { manual: [{ id: `m_${tag}`, type: 'anniversary', date: '05-20', title: `${tag}紀念日` }] } } } : {} },
  ...Array.from({ length: n * 2 }, (_, i) => ({ name: i % 2 ? '角色' : '小雨', is_user: !(i % 2), mes: `${tag}第${i}則`, send_date: `${tag}${i}`, extra: withData && i % 2 ? lp(`${tag}摘要${i}`) : {} })),
];
const FILES = {
  'shenyan.png': { 雨天的約定: null, 海邊那天: file('sea', 3), 沒用過的: file('none', 2, false) },
  'guyan.png': { 顧言的聊天: file('gu', 2) },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text()); });
await page.route('**/api/characters/chats', (r) => {
  const { avatar_url } = JSON.parse(r.request().postData());
  const list = Object.keys(FILES[avatar_url] ?? {}).map((id) => ({ file_id: id, file_size: '1KB', chat_items: 4, last_mes: '2026-10-01' }));
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) });
});
const reads = [];
await page.route('**/api/chats/get', (r) => {
  const { file_name, avatar_url } = JSON.parse(r.request().postData());
  reads.push(file_name);
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FILES[avatar_url]?.[file_name] ?? []) });
});
await page.addInitScript(() => {
  window.__chatId = '雨天的約定';
  window.__characters = [{ name: '沈言', avatar: 'shenyan.png' }, { name: '顧言', avatar: 'guyan.png' }];
  window.__chat = Array.from({ length: 8 }, (_, i) => ({ name: i % 2 ? '沈言' : '小雨', is_user: !(i % 2), mes: `第${i}則`, send_date: `d${i}`, extra: {} }));
  window.__toasts = [];
  window.toastr = { success: (m) => window.__toasts.push(m), info: (m) => window.__toasts.push(m), warning: (m) => window.__toasts.push(m), error: (m) => window.__toasts.push(m) };
  window.__presetSettings = { lovers_planner: { settingsVersion: 5, summary: { mode: 'manual' }, compress: { auto: false }, ui: { seenVersion: '9.9.9' }, backup: { auto: false } } };
});
await page.goto(URL);
await page.waitForFunction(() => Boolean(globalThis.loversPlannerInterceptor));
await page.evaluate(async () => {
  const s = await import('/src/summarize.js');
  s.writeSummary(1, { summary: '現在的第一層' });
  s.writeSummary(3, { summary: '現在的第二層' });
  (await import('/src/prefs.js')).addPref('早上要叫我起床');
});
await page.evaluate(() => { document.getElementById('extensionsMenu').style.display = ''; document.getElementById('lp_wand_entry').click(); });
await page.click('[data-tab="settings"]');
await page.click('details[data-sec="data"] > summary');

// 這個角色的全部聊天
let [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="bundle-export"]')]);
let path = `${OUT}/bundle-char.json`;
await dl.saveAs(path);
let data = JSON.parse(fs.readFileSync(path, 'utf8'));
check('this character: chats with data only, current one from memory', data.format === 'lovers-planner-bundle' && data.chats.map((x) => x.chat).sort().join(',') === '海邊那天,雨天的約定'
  && data.chats.find((x) => x.chat === '雨天的約定').data.floors.length === 2 && !reads.includes('雨天的約定'), JSON.stringify(data.chats.map((x) => [x.chat, x.data.floors.length])));
check('old chat read without opening, with its calendar', data.chats.find((x) => x.chat === '海邊那天').data.meta.calendar.manual[0].title === 'sea紀念日');
check('character part (preferences) included', data.characters['shenyan.png']?.prefs?.[0]?.text === '早上要叫我起床');
check('file name is plain ASCII', /^lovers-planner-all_[A-Za-z0-9_.-]+\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
await page.waitForSelector('[data-role="bundle-msg"]');
check('done message', (await page.textContent('[data-role="bundle-msg"]')).includes('2 個聊天（1 個角色）'));

// 所有角色
await page.check('[data-role="bundle-scope"][value="all"]');
[dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="bundle-export"]')]);
path = `${OUT}/bundle-all.json`;
await dl.saveAs(path);
data = JSON.parse(fs.readFileSync(path, 'utf8'));
check('all characters', data.scope === 'all' && data.chats.length === 3 && data.chats.some((x) => x.avatar === 'guyan.png' && x.chat === '顧言的聊天'), JSON.stringify(data.chats.map((x) => x.chat)));
await page.locator('[data-role="bundle"]').screenshot({ path: `${OUT}/bundle.png` });

// 導入：先把現在的清掉、偏好刪掉
await page.evaluate(async () => {
  for (const m of window.__chat) if (m.extra) delete m.extra.lovers_planner;
  const p = await import('/src/prefs.js');
  for (const x of p.listPrefs()) p.removePref(x.id);
  SillyTavern.getContext().extensionSettings.lovers_planner.characters['shenyan.png'].prefsRemoved = [];
});
await page.setInputFiles('[data-role="data-file"]', path);
await page.waitForSelector('[data-role="data-file-info"]');
check('bundle recognized on import', (await page.textContent('[data-role="data-file-info"]')).includes('打包檔，3 個聊天（2 個角色）'));
await page.click('[data-action="data-import"]');
await page.waitForFunction(() => document.querySelector('[data-role="data-message"]')?.textContent.includes('導入好了'), null, { timeout: 10000 });
check('current chat restored now, others later', (await page.textContent('[data-role="data-message"]')).includes('放回了 2 層；另外 2 個聊天'), await page.textContent('[data-role="data-message"]'));
check('summaries back in the open chat', await page.evaluate(() => window.__chat[1].extra?.lovers_planner?.summary === '現在的第一層'));
check('preferences back', await page.evaluate(async () => (await import('/src/prefs.js')).listPrefs().some((p) => p.text === '早上要叫我起床')));
check('safety backup before importing', await page.evaluate(async () => (await import('/src/autobackup.js')).listBackups().some((e) => e.reason === 'before')));
check('pending count shown', (await page.textContent('[data-role="bundle-pending"]')).includes('還有 2 個聊天'));

// 打開另一個聊天：自動放回
await page.evaluate(async () => {
  window.__chatId = '海邊那天';
  window.__chat.length = 0;
  for (let i = 0; i < 6; i++) window.__chat.push({ name: i % 2 ? '沈言' : '小雨', is_user: !(i % 2), mes: `sea第${i}則`, send_date: `sea${i}`, extra: {} });
  await (await import('/src/bundle.js')).applyPending();
});
const sea = await page.evaluate(() => ({ floors: window.__chat.filter((m) => m.extra?.lovers_planner?.summary).length, cal: SillyTavern.getContext().chatMetadata.lovers_planner?.calendar?.manual?.[0]?.title, toast: window.__toasts.find((x) => String(x).includes('放回了導入的備份')) }));
check('other chat restored when opened', sea.floors === 3 && sea.cal === 'sea紀念日' && Boolean(sea.toast), JSON.stringify(sea));
check('pending list shrinks', (await page.evaluate(async () => (await import('/src/bundle.js')).pendingCount())) === 1);
check('not applied twice', (await page.evaluate(async () => (await import('/src/bundle.js')).applyPending())) === null);

const missing = await page.evaluate(async () => (await import('/src/i18n.js')).missingKeys());
check('i18n keys complete', !missing.length, JSON.stringify(missing));
for (const l of results) console.log(l);
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
