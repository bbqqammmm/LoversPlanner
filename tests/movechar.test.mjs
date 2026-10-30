// 🚚 搬到別的酒館（v0.13.52，使用者要求：從 TauriTavern 搬一個角色到 SillyTavern，好幾個聊天）：
// 打包檔帶上各聊天的快照；導入時角色卡檔名不一樣用名字對上、聊天被改名用 send_date 認出來；
// 「即時共用」的摘要讀得到改名後的來源；日記記的舊聊天名字換成新的。
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [execSync('npm root -g').toString().trim()] }));

const OUT = process.argv[2] ?? '.';
const URL = `http://127.0.0.1:${process.env.PORT ?? 8765}/tests/harness.html`;
const results = [];
const errors = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text()); });

// ===== 1. 原本的酒館：打包檔帶上快照 =====
await page.addInitScript(() => {
  window.__chatId = '海邊那天';
  window.__characters = [{ name: '沈言', avatar: 'shenyan.png' }];
  window.__chat = Array.from({ length: 6 }, (_, i) => ({ name: i % 2 ? '沈言' : '小雨', is_user: !(i % 2), mes: `第${i}則`, send_date: `sea${i}`, extra: {} }));
  window.__presetSettings = { lovers_planner: { settingsVersion: 5, summary: { mode: 'manual' }, compress: { auto: false }, ui: { seenVersion: '9.9.9' }, backup: { auto: false } } };
});
await page.route('**/api/characters/chats', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ file_id: '海邊那天' }]) }));
await page.goto(URL);
await page.waitForFunction(() => Boolean(globalThis.loversPlannerInterceptor));
const bundle = await page.evaluate(async () => {
  const s = await import('/src/summarize.js');
  s.writeSummary(1, { summary: '在海邊撿貝殼。' });
  s.writeSummary(3, { summary: '看夕陽。' });
  (await import('/src/carry.js')).writeSnapshot();
  (await import('/src/prefs.js')).addPref('早上要叫我起床');
  return (await (await import('/src/bundle.js')).buildBundle({ scope: 'character' })).data;
});
check('bundle carries the snapshots', bundle.characters['shenyan.png']?.chats?.['海邊那天']?.lines?.some((l) => l.includes('在海邊撿貝殼')), JSON.stringify(bundle.characters['shenyan.png']?.chats ?? {}).slice(0, 200));

// ===== 2. 新的酒館：角色卡叫 沈言1.png，聊天被改名成「… imported」 =====
// 現在開著的是「雨天的約定」搬過來的那個，它「即時共用」海邊那天的摘要。
const page2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
page2.on('pageerror', (e) => errors.push('pageerror2: ' + e.message));
page2.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console2: ' + m.text()); });
const SEA = [{ user_name: '小雨', character_name: '沈言', chat_metadata: {} }, ...Array.from({ length: 6 }, (_, i) => ({ name: i % 2 ? '沈言' : '小雨', is_user: !(i % 2), mes: `第${i}則`, send_date: `sea${i}`, extra: {} }))];
const OTHER = [{ user_name: '小雨', character_name: '沈言', chat_metadata: {} }, { name: '沈言', is_user: false, mes: '別的', send_date: 'zzz1', extra: {} }];
await page2.route('**/api/characters/chats', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
  { file_id: '沈言 - 2026-10-30@12h00m00s imported' }, { file_id: '沈言 - 2026-10-30@12h01m00s imported' }, { file_id: '沈言 - 2026-10-30@12h02m00s imported' }]) }));
const reads = [];
await page2.route('**/api/chats/get', (r) => {
  const { file_name, avatar_url } = JSON.parse(r.request().postData());
  reads.push(`${avatar_url}:${file_name}`);
  const body = file_name.includes('12h01m') ? SEA : OTHER;
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
await page2.addInitScript(() => {
  window.__chatId = '沈言 - 2026-10-30@12h00m00s imported';
  window.__characters = [{ name: '沈言', avatar: '沈言1.png' }];
  window.__chat = Array.from({ length: 4 }, (_, i) => ({ name: i % 2 ? '沈言' : '小雨', is_user: !(i % 2), mes: `雨${i}`, send_date: `rain${i}`, extra: {} }));
  window.__presetSettings = { lovers_planner: { settingsVersion: 5, summary: { mode: 'manual' }, compress: { auto: false }, ui: { seenVersion: '9.9.9' }, backup: { auto: false } } };
});
await page2.goto(URL);
await page2.waitForFunction(() => Boolean(globalThis.loversPlannerInterceptor));
await page2.evaluate(() => {
  const meta = SillyTavern.getContext().chatMetadata;
  meta.lovers_planner = { ...(meta.lovers_planner ?? {}), summaryLink: { source: '海邊那天', at: 1 }, scope: { summary: 'share' } };
});
const before = await page2.evaluate(async () => (await import('/src/carry.js')).getLinkedSummary());
const r = await page2.evaluate(async (data) => (await import('/src/bundle.js')).importBundle(data), bundle);
check('import: card matched by name, renamed chat recognized', r.moved === 1 && r.renamed === 1 && r.later === 1, JSON.stringify(r));
check('only read the chats it had to', reads.every((x) => x.startsWith('沈言1.png:')) && reads.length <= 3, JSON.stringify(reads));
const after = await page2.evaluate(async () => {
  const s = SillyTavern.getContext().extensionSettings.lovers_planner;
  const rec = s.characters['沈言1.png'] ?? {};
  const linked = (await import('/src/carry.js')).getLinkedSummary();
  const { currentChatId } = await import('/src/scope.js');
  return { prefs: (rec.prefs ?? []).map((p) => p.text), snaps: Object.keys(rec.chats ?? {}), renamed: rec.renamed, linked: linked && { missing: linked.missing, lines: linked.lines }, alias: currentChatId('海邊那天') };
});
check('linked summary was missing before', before?.missing === true, JSON.stringify(before));
check('preferences restored to the new card', after.prefs.includes('早上要叫我起床'), JSON.stringify(after.prefs));
check('snapshot stored under the new chat name', after.snaps.includes('沈言 - 2026-10-30@12h01m00s imported') && after.alias === '沈言 - 2026-10-30@12h01m00s imported', JSON.stringify(after));
check('live-shared summary works again', after.linked && !after.linked.missing && after.linked.lines.some((l) => l.includes('在海邊撿貝殼')), JSON.stringify(after.linked));
const pending = await page2.evaluate(async () => (await import('/src/autobackup.js')).browserStore('get', 'pending-imports'));
check('pending restore keyed by the new names', Array.isArray(pending) && pending.some((p) => p.avatar === '沈言1.png' && p.chat === '沈言 - 2026-10-30@12h01m00s imported'), JSON.stringify((pending ?? []).map((p) => [p.avatar, p.chat])));

// 設定頁有搬家的說明
await page2.evaluate(() => { document.getElementById('extensionsMenu').style.display = ''; document.getElementById('lp_wand_entry').click(); });
await page2.click('[data-tab="settings"]');
await page2.click('details[data-sec="data"] > summary');
await page2.click('[data-role="bundle-move"] > summary');
check('moving guide shown', (await page2.textContent('[data-role="bundle-move"]')).includes('先導入角色卡'));
await page2.locator('[data-role="bundle"]').screenshot({ path: `${OUT}/bundle-move.png` });

const missing = await page2.evaluate(async () => (await import('/src/i18n.js')).missingKeys());
check('i18n keys complete', !missing.length, JSON.stringify(missing));
for (const l of results) console.log(l);
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
