// 🔗 對應改過名的聊天（v0.13.61，使用者要求：從酒館搬到 TT 時聊天改了名，日記記的還是舊名字，原文搜尋找不到）：
// 日記記著、現在找不到的聊天列出來；自動配對（一個一個讀聊天、比故事日期）；儲存後日記、原文搜尋都用新名字；可以取消。
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [execSync('npm root -g').toString().trim()] }));

const OUT = process.argv[2] ?? '.';
const URL = `http://127.0.0.1:${process.env.PORT ?? 8765}/tests/harness.html`;
const results = [];
const errors = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

// 搬過來後的聊天：檔名換了，內容一樣（每層有戀人手帳記的故事日期）
const file = (dates) => [{ chat_metadata: {} }, ...dates.flatMap((date, k) => [
  { name: '小雨', is_user: true, mes: `第${k}天早安`, send_date: `${date}u`, extra: {} },
  { name: '沈言', is_user: false, mes: `第${k}天`, send_date: `${date}a`, extra: { lovers_planner: { v: 2, status: 'ok', summary: `第${k}天`, date } } },
])];
const FILES = {
  '沈言 - 2026-11-01 imported': file(['2025-03-01', '2025-03-02', '2025-03-03']),
  '沈言 - 2026-11-02 imported': file(['2025-04-10', '2025-04-11']),
  '別的聊天': file(['2025-08-01']),
};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text()); });
await page.route('**/api/characters/chats', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ file_id: '新聊天' }, ...Object.keys(FILES).map((file_id) => ({ file_id }))]) }));
const reads = [];
await page.route('**/api/chats/get', (r) => {
  const { file_name } = JSON.parse(r.request().postData());
  reads.push(file_name);
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FILES[file_name] ?? []) });
});
await page.addInitScript(() => {
  window.__chatId = '新聊天';
  window.__chat = [{ name: '沈言', is_user: false, mes: '歡迎', send_date: 'n0', extra: {} }];
  window.__presetSettings = { lovers_planner: { settingsVersion: 6, summary: { mode: 'manual' }, ui: { seenVersion: '9.9.9' }, backup: { auto: false } } };
});
await page.goto(URL);
await page.waitForFunction(() => Boolean(globalThis.loversPlannerInterceptor));
await page.evaluate(() => {
  const part = (summary) => ({ part: 1, total: 1, floors: 3, summary, points: [], at: 1, by: 'x', style: 'natural' });
  const day = (date, chat) => ({ date, parts: [part(`${date} 的日記`)], use: 'original', chats: [chat] });
  SillyTavern.getContext().chatMetadata.lovers_planner = {
    ...(SillyTavern.getContext().chatMetadata.lovers_planner ?? {}),
    diary: { sources: ['雨天(舊)', '海邊(舊)'], days: {
      '2025-03-01': day('2025-03-01', '雨天(舊)'), '2025-03-02': day('2025-03-02', '雨天(舊)'), '2025-03-03': day('2025-03-03', '雨天(舊)'),
      '2025-04-10': day('2025-04-10', '海邊(舊)'), '2025-04-11': day('2025-04-11', '海邊(舊)'),
    } },
  };
});
await page.evaluate(() => { document.getElementById('extensionsMenu').style.display = ''; document.getElementById('lp_wand_entry').click(); });
await page.click('[data-tab="diary"]');
await page.waitForSelector('[data-role="rename"]');
let card = await page.textContent('[data-role="rename"]');
check('lists the chats the diary knows but cannot find', card.includes('有 2 個找不到') && card.includes('雨天(舊)') && card.includes('寫過 3 天日記') && card.includes('海邊(舊)'), card.replace(/\s+/g, ' ').slice(0, 200));

await page.click('[data-action="rename-guess"]');
await page.waitForSelector('[data-role="rename-msg"]');
const picks = await page.evaluate(() => [...document.querySelectorAll('[data-role="rename-pick"]')].map((el) => `${el.dataset.old}=${el.value}`));
check('auto match by story dates', JSON.stringify(picks) === JSON.stringify(['雨天(舊)=沈言 - 2026-11-01 imported', '海邊(舊)=沈言 - 2026-11-02 imported']), JSON.stringify(picks));
check('read the chats without opening them, not the current one', !reads.includes('新聊天') && reads.includes('別的聊天'), JSON.stringify(reads));
card = await page.textContent('[data-role="rename"]');
check('shows how sure it is', card.includes('3 天裡對到 3 天') && card.includes('猜好了 2 個'), card.replace(/\s+/g, ' ').slice(0, 300));
await page.locator('[data-role="rename"]').screenshot({ path: `${OUT}/rename.png` });

await page.click('[data-action="rename-save"]');
const after = await page.evaluate(async () => {
  const { currentChatId } = await import('/src/scope.js');
  const { diaryRanges } = await import('/src/diary.js');
  return { a: currentChatId('雨天(舊)'), chats: [...new Set(diaryRanges().flatMap((d) => d.chats))] };
});
check('saved: old names now point to the new ones', after.a === '沈言 - 2026-11-01 imported' && JSON.stringify(after.chats.sort()) === JSON.stringify(['沈言 - 2026-11-01 imported', '沈言 - 2026-11-02 imported']), JSON.stringify(after));
card = await page.textContent('[data-role="rename"]');
check('card shows what is matched', card.includes('已經對應的') && card.includes('雨天(舊) → 沈言 - 2026-11-01 imported') && !card.includes('找不到'), card.replace(/\s+/g, ' ').slice(0, 300));
await page.click('[data-action="rename-undo"][data-old="海邊(舊)"]');
card = await page.textContent('[data-role="rename"]');
check('can unmatch', card.includes('有 1 個找不到') && card.includes('海邊(舊)'), card.replace(/\s+/g, ' ').slice(0, 200));

const missing = await page.evaluate(async () => (await import('/src/i18n.js')).missingKeys());
check('i18n keys complete', !missing.length, JSON.stringify(missing));
for (const l of results) console.log(l);
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
