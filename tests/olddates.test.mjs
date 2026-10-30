// 🗓️ 舊聊天的日期從標籤或文字讀（v0.13.44，使用者回報：沒摘要過、也沒用 Horae 的聊天，全部「沒有日期」）：
// 自動找哪個標籤裡常有完整日期（只有月日的用上一個日期的年份）；沒有的話找純文字的「日期：…」；可以改選或不用。
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [execSync('npm root -g').toString().trim()] }));

const OUT = process.argv[2] ?? '.';
const URL = `http://127.0.0.1:${process.env.PORT ?? 8765}/tests/harness.html`;
const results = [];
const errors = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

const head = { user_name: '小雨', character_name: '沈言', chat_metadata: {} };
let k = 0;
const msg = (ai, mes) => ({ name: ai ? '沈言' : '小雨', is_user: !ai, mes, send_date: `t${k++}`, extra: {} });
// 狀態欄標籤裡有日期；<weather> 裡沒有；正文裡提到別的日期（不能被當成故事日期）
const TAGGED = [head,
  msg(false, '早安'), msg(true, '<status>日期：2025年10月21日 星期二\n地點：家</status>\n他說明年5月20日要去看海。<weather>晴</weather>'),
  msg(false, '然後呢'), msg(true, '<status>日期：2025年10月21日\n地點：公司</status>\n下班了。'),
  msg(false, '隔天'), msg(true, '<status>日期：10月22日 星期三</status>\n第二天早上。'),
  msg(false, '再隔天'), msg(true, '<status>日期：2025/10/23</status>\n第三天。'),
];
// 沒有標籤，日期寫在純文字的一行
const PLAIN = [head,
  msg(false, '嗨'), msg(true, '【日期】：2025年11月03日\n今天下雨。'),
  msg(false, '嗯'), msg(true, '時間：2025-11-04 早上\n出門上班。'),
  msg(false, '好'), msg(true, '日期：2025/11/04\n晚上回家。'),
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text()); });
await page.route('**/api/characters/chats', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ file_id: '有標籤的', file_size: '1KB', chat_items: 8, last_mes: '2026-10-02' }, { file_id: '純文字的', file_size: '1KB', chat_items: 6, last_mes: '2026-10-01' }]) }));
await page.route('**/api/chats/get', (r) => {
  const { file_name } = JSON.parse(r.request().postData());
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(file_name === '有標籤的' ? TAGGED : PLAIN) });
});
await page.addInitScript(() => {
  window.__chatId = '新聊天';
  window.__chat = Array.from({ length: 4 }, (_, i) => ({ name: i % 2 ? '沈言' : '小雨', is_user: !(i % 2), mes: `第${i}則`, send_date: `c${i}`, extra: {} }));
  window.__presetSettings = { lovers_planner: { settingsVersion: 5, summary: { mode: 'manual' }, ui: { seenVersion: '9.9.9' } } };
});
await page.goto(URL);
await page.waitForFunction(() => Boolean(globalThis.loversPlannerInterceptor));

// 直接分析
const a = await page.evaluate(async (data) => {
  const o = await import('/src/oldchats.js');
  const r = o.analyzeChats([{ id: 'x', data }]);
  return { mode: r.dates.mode, tag: r.dates.tag, days: r.days.map((d) => `${d.date}:${d.ai}`), found: r.totals.found, undated: r.totals.undated };
}, TAGGED);
check('date tag found automatically', a.mode === 'tag' && a.tag === 'status', JSON.stringify(a));
check('days split by the tag dates (month-day uses the last year; story text ignored)', JSON.stringify(a.days) === '["2025-10-21:2","2025-10-22:1","2025-10-23:1"]' && a.found === 4 && !a.undated, JSON.stringify(a));
const b = await page.evaluate(async (data) => {
  const r = (await import('/src/oldchats.js')).analyzeChats([{ id: 'y', data }]);
  return { mode: r.dates.mode, days: r.days.map((d) => `${d.date}:${d.ai}`) };
}, PLAIN);
check('plain "date:" lines used when no tag has dates', b.mode === 'text' && JSON.stringify(b.days) === '["2025-11-03:1","2025-11-04:2"]', JSON.stringify(b));

// 畫面：顯示從哪裡讀、可以改成不用
await page.evaluate(() => { document.getElementById('extensionsMenu').style.display = ''; document.getElementById('lp_wand_entry').click(); });
await page.click('[data-tab="diary"]');
await page.click('[data-action="old-open"]');
await page.click('[data-action="old-pick"][data-id="有標籤的"]');
await page.click('[data-action="old-read"]');
await page.waitForSelector('[data-role="old-dates"]');
const res = await page.textContent('[data-role="old-result"]');
check('result says where dates came from', res.includes('4 層的日期從 <status> 標籤讀到') && res.includes('3 個故事日'), res.replace(/\s+/g, ' ').slice(0, 200));
await page.locator('[data-role="old-dates"]').screenshot({ path: `${OUT}/olddates.png` });
await page.selectOption('[data-role="old-date-src"]', 'none');
const off = await page.textContent('[data-role="old-result"]');
check('switching to none: undated again, with help', off.includes('找不到日期') && off.includes('找不到故事日期'), off.replace(/\s+/g, ' ').slice(0, 300));
await page.selectOption('[data-role="old-date-src"]', 'tag:status');
check('switch back to the tag', (await page.textContent('[data-action="diary-start"]')).includes('3 天'));

const missing = await page.evaluate(async () => (await import('/src/i18n.js')).missingKeys());
check('i18n keys complete', !missing.length, JSON.stringify(missing));
for (const l of results) console.log(l);
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
