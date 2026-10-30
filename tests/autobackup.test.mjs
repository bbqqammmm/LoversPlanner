// 🛟 自動備份＋防失憶警報（v0.13.37）：打開聊天時備份、摘要變多時備份、留幾份輪流蓋、存在酒館的資料夾（存不了改存瀏覽器）；
// 摘要突然不見 → 警報（先不自動備份）→ 一鍵放回（放回前先存一份）；自己刪的不算；設定頁的清單和放回。
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [execSync('npm root -g').toString().trim()] }));

const OUT = process.argv[2] ?? '.';
const URL = `http://127.0.0.1:${process.env.PORT ?? 8765}/tests/harness.html`;
const results = [];
const errors = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

const files = new Map();
const calls = { upload: 0, del: 0 };
let uploadBroken = false;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|status of (404|500)/.test(m.text())) errors.push('console: ' + m.text()); });
await page.route('**/api/files/upload', async (r) => {
  calls.upload++;
  if (uploadBroken) return r.fulfill({ status: 500, body: 'no' });
  const { name, data } = JSON.parse(r.request().postData());
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) return r.fulfill({ status: 400, body: 'bad name' });
  files.set(name, Buffer.from(data, 'base64').toString('utf8'));
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ path: `user/files/${name}` }) });
});
await page.route('**/api/files/delete', async (r) => {
  calls.del++;
  files.delete(JSON.parse(r.request().postData()).path.replace('user/files/', ''));
  return r.fulfill({ status: 200, body: '' });
});
await page.route('**/user/files/**', (r) => {
  const name = decodeURIComponent(r.request().url().split('?')[0].split('/').pop());
  return files.has(name) ? r.fulfill({ status: 200, contentType: 'application/json', body: files.get(name) }) : r.fulfill({ status: 404, body: '' });
});
await page.addInitScript(() => {
  window.__realFiles = true;
  window.__autoBackup = true;
  window.__chatId = '雨天的約定';
  window.__chat = Array.from({ length: 60 }, (_, i) => ({ name: i % 2 ? '沈言' : '小雨', is_user: !(i % 2), mes: `第${i}則`, send_date: `d${i}`, extra: {} }));
  window.__toasts = [];
  window.toastr = { success: (m) => window.__toasts.push(m), info: (m) => window.__toasts.push(m), warning: (m) => { window.__toasts.push(m); return null; }, error: (m) => window.__toasts.push(m) };
  window.__presetSettings = { lovers_planner: { settingsVersion: 5, summary: { mode: 'manual' }, compress: { auto: false }, ui: { seenVersion: '9.9.9' } } };
});
await page.goto(URL);
await page.waitForFunction(() => Boolean(globalThis.loversPlannerInterceptor));
// 摘要 20 層（打開聊天 6 秒後才會檢查，這之前寫好）
await page.evaluate(async () => {
  const s = await import('/src/summarize.js');
  for (let i = 1; i < 40; i += 2) s.writeSummary(i, { summary: `第${i}層的摘要`, date: '2025-05-01' });
});
await page.evaluate(async () => { const b = await import('/src/autobackup.js'); for (let i = 0; i < 150 && !b.listBackups().length; i++) await new Promise((r) => setTimeout(r, 100)); });
let list = await page.evaluate(async () => (await import('/src/autobackup.js')).listBackups());
check('first open: backed up automatically', list.length === 1 && list[0].reason === 'day' && list[0].floors === 20 && list[0].where === 'tavern', JSON.stringify(list));
const name = [...files.keys()][0] ?? '';
check('saved in the tavern folder with a plain file name', /^lp-bk_[0-9a-f]+_0\.json$/.test(name), name);
const saved = JSON.parse(files.get(name) ?? '{}');
check('backup holds the summaries, not the chat text', saved.format === 'lovers-planner-backup' && saved.floors.length === 20 && saved.floors[0].entry.summary === '第1層的摘要' && !JSON.stringify(saved).includes('第2則') && !saved.settings, JSON.stringify(saved).slice(0, 200));
check('not again on the same day', await page.evaluate(async () => (await (await import('/src/autobackup.js')).maybeBackup('open')) === null));

// 摘要多 5 層（門檻改成 5）→ 備份
await page.evaluate(async () => {
  SillyTavern.getContext().extensionSettings.lovers_planner.backup.everyFloors = 5;
  const s = await import('/src/summarize.js');
  for (let i = 41; i < 51; i += 2) s.writeSummary(i, { summary: `第${i}層的摘要` });
  await (await import('/src/autobackup.js')).maybeBackup('floors');
});
list = await page.evaluate(async () => (await import('/src/autobackup.js')).listBackups());
check('more summaries: backed up again', list.length === 2 && list[0].reason === 'floors' && list[0].floors === 25, JSON.stringify(list.map((e) => [e.reason, e.floors])));

// 留 3 份：多的輪流蓋掉
await page.evaluate(async () => {
  SillyTavern.getContext().extensionSettings.lovers_planner.backup.keep = 3;
  const b = await import('/src/autobackup.js');
  for (let k = 0; k < 3; k++) await b.backupNow('manual');
});
list = await page.evaluate(async () => (await import('/src/autobackup.js')).listBackups());
check('keeps only the latest 3, reusing slots', list.length === 3 && new Set(list.map((e) => e.slot)).size === 3 && files.size === 3, JSON.stringify({ slots: list.map((e) => e.slot), files: files.size }));

// 失憶：別的東西把摘要清掉了
await page.evaluate(() => { for (const m of window.__chat) if (m.extra) delete m.extra.lovers_planner; });
const alarm = await page.evaluate(async () => { const b = await import('/src/autobackup.js'); const a = b.checkAlarm(); return { a, auto: await b.maybeBackup('open') }; });
check('alarm when summaries drop sharply', alarm.a?.backup.total === 25 && alarm.a.now.total === 0, JSON.stringify(alarm.a));
check('no automatic backup while alarmed', alarm.auto === null && (await page.evaluate(async () => (await import('/src/autobackup.js')).listBackups().length)) === 3);
await page.evaluate(() => { document.getElementById('extensionsMenu').style.display = ''; document.getElementById('lp_wand_entry').click(); });
check('banner at the top of the panel', (await page.textContent('[data-role="alarm-banner"]')).includes('備份裡有 25 份，現在只剩 0 份'));
await page.click('[data-action="alarm-go"]');
await page.waitForSelector('[data-role="backup-alarm"]');
await page.locator('[data-role="autobackup"]').screenshot({ path: `${OUT}/backup-alarm.png` });
await page.click('[data-role="backup-alarm"] [data-action="backup-restore-yes"]');
await page.waitForFunction(() => document.querySelector('[data-role="backup-msg"]')?.textContent.includes('放回了'), null, { timeout: 10000 });
let floors = await page.evaluate(() => window.__chat.filter((m) => m.extra?.lovers_planner?.status === 'ok').length);
check('restored from the latest backup', floors === 25, String(floors));
list = await page.evaluate(async () => (await import('/src/autobackup.js')).listBackups());
const before = list.find((e) => e.slot === 'r');
check('state before restoring saved separately, good backups kept', before?.reason === 'before' && before.floors === 0 && list.filter((e) => e.slot !== 'r').length === 3, JSON.stringify(list.map((e) => [e.slot, e.reason, e.floors])));
check('alarm cleared', !(await page.$('[data-role="backup-alarm"]')) && !(await page.evaluate(async () => (await import('/src/autobackup.js')).checkAlarm())));
const injAfter = await page.evaluate(async () => (await window.__runInterceptor('normal')).injection?.value ?? '');
check('injection works again after restore', injAfter.includes('第1層的摘要'), injAfter.slice(0, 300));

// 清單：放回某一份要先確認
await page.click('[data-role="backup-list"] > summary');
await page.click('[data-backup="r"] [data-action="backup-restore"]');
check('restore asks first', (await page.textContent('[data-backup="r"]')).includes('現在的樣子會先存一份'));
await page.click('[data-action="backup-restore-no"]');
await page.locator('[data-role="autobackup"]').screenshot({ path: `${OUT}/backup.png` });

// 自己刪的（資料管理 › 刪除）不算失憶
await page.evaluate(() => { window.__downloads = 0; HTMLAnchorElement.prototype.click = function () { window.__downloads++; }; });
await page.click('[data-action="data-wipe"]');
await page.click('[data-action="data-wipe"]');
check('own deletion does not raise the alarm', !(await page.evaluate(async () => (await import('/src/autobackup.js')).checkAlarm())));

// 酒館的資料夾存不了：改存瀏覽器，一樣能放回
uploadBroken = true;
await page.evaluate(async () => {
  const s = await import('/src/summarize.js');
  for (let i = 1; i < 21; i += 2) s.writeSummary(i, { summary: `新的第${i}層` });
});
const fb = await page.evaluate(async () => { const b = await import('/src/autobackup.js'); return b.backupNow('manual'); });
check('falls back to the browser', fb?.where === 'browser', JSON.stringify(fb));
await page.evaluate(() => { for (const m of window.__chat) if (m.extra) delete m.extra.lovers_planner; });
const r2 = await page.evaluate(async (slot) => (await import('/src/autobackup.js')).restoreBackup(slot), fb.slot);
floors = await page.evaluate(() => window.__chat.filter((m) => m.extra?.lovers_planner?.status === 'ok').length);
check('restore from the browser copy', r2.matched === 10 && floors === 10, JSON.stringify(r2));
await page.click('[data-tab="settings"]');
await page.waitForSelector('[data-role="autobackup"]');
check('tells the user it is in the browser', (await page.textContent('[data-role="autobackup"]')).includes('存在這個瀏覽器'));

// 設定：備份索引不跟著設定導出，導入設定也不會蓋掉它
const settingsOut = await page.evaluate(async () => (await import('/src/backup.js')).buildBackup({ settings: true }).settings);
check('backup index not exported with settings', !('backupIndex' in settingsOut) && settingsOut.backup?.keep === 3);

const missing = await page.evaluate(async () => (await import('/src/i18n.js')).missingKeys());
check('i18n keys complete', !missing.length, JSON.stringify(missing));
for (const l of results) console.log(l);
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
