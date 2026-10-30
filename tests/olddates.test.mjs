// 🗓️ 舊聊天的日期從標籤或文字讀（v0.13.44，使用者回報：沒摘要過、也沒用 Horae 的聊天，全部「沒有日期」）：
// 自動找哪個標籤裡常有完整日期（只有月日的用上一個日期的年份）；沒有的話找純文字的「日期：…」；可以改選或不用。
// v0.13.48：可以勾好幾個；列出沒日期的樓層；開頭沒日期的可以算進第一天；每天寫第幾層；整層小劇場的不寫。
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
await page.uncheck('[data-role="old-date-src"][value="tag:status"]');
const off = await page.textContent('[data-role="old-result"]');
check('unticking: undated again, with help', off.includes('找不到日期') && off.includes('找不到故事日期'), off.replace(/\s+/g, ' ').slice(0, 300));
await page.check('[data-role="old-date-src"][value="tag:status"]');
check('tick the tag again', (await page.textContent('[data-action="diary-start"]')).includes('3 天'));

// 好幾個地方一起用（v0.13.48）：<details> 和 <tableEdit> 各有一部分的日期；開頭幾層沒日期；整層都是小劇場的不寫
const MIX = [head,
  msg(false, '（開場）'), msg(true, '開場白，還沒有日期。'),
  msg(false, '嗯'), msg(true, '開場的第二層。'),
  msg(false, '早'), msg(true, '<details>2025年3月1日 晴</details>\n第一天早上。'),
  msg(false, '午'), msg(true, '<tableEdit>日期：2025/03/02</tableEdit>\n第二天中午。'),
  msg(false, '晚'), msg(true, '<small_theater>番外：如果他們是同學……</small_theater>'),
  msg(false, '隔天'), msg(true, '<details>2025年3月3日</details>\n第三天。<small_theater>番外小段</small_theater>'),
];
const mix = await page.evaluate(async (data) => {
  const o = await import('/src/oldchats.js');
  const one = o.analyzeChats([{ id: 'z', data }], { dates: o.withSources(o.detectDates([{ id: 'z', data }]), ['tag:details']) });
  const both = o.analyzeChats([{ id: 'z', data }], { dates: o.withSources(one.dates, ['tag:details', 'tag:tableEdit']) });
  const lead = o.analyzeChats([{ id: 'z', data }], { dates: both.dates, leadIn: true });
  const day3 = o.dayParts('2025-03-03')[0]?.units.map((u) => u.text).join('|');
  const pick = (r) => ({ days: r.days.map((d) => `${d.date}:${d.ai}`), undated: r.undated.map((u) => `#${u.floor}:${u.text}`), foundBy: r.totals.foundBy, empty: r.totals.empty, leadIn: r.totals.leadIn, ranges: r.days.map((d) => d.ranges) });
  return { one: pick(one), both: pick(both), lead: pick(lead), day3 };
}, MIX);
check('one tag: the other tag\'s day follows the day before', JSON.stringify(mix.one.days) === '["2025-03-01:2","2025-03-03:1",":2"]', JSON.stringify(mix.one));
check('two tags together', JSON.stringify(mix.both.days) === '["2025-03-01:1","2025-03-02:1","2025-03-03:1",":2"]' && mix.both.foundBy['tag:details'] === 2 && mix.both.foundBy['tag:tableEdit'] === 1, JSON.stringify(mix.both));
check('undated floors listed with floor number and text', JSON.stringify(mix.both.undated) === '["#1:開場白，還沒有日期。","#3:開場的第二層。"]', JSON.stringify(mix.both.undated));
check('a floor that is only a side story is left out; <small_theater> stripped', mix.both.empty === 1 && !mix.day3.includes('番外') && mix.day3.includes('第三天'), JSON.stringify({ empty: mix.both.empty, day3: mix.day3 }));
check('lead-in: opening floors count as the first day', JSON.stringify(mix.lead.days) === '["2025-03-01:3","2025-03-02:1","2025-03-03:1"]' && mix.lead.leadIn === 2 && !mix.lead.undated.length, JSON.stringify(mix.lead));
check('floor ranges per day', JSON.stringify(mix.lead.ranges[0]) === '[{"chat":"z","from":1,"to":5}]' && JSON.stringify(mix.lead.ranges[1]) === '[{"chat":"z","from":7,"to":7}]', JSON.stringify(mix.lead.ranges));

// 畫面：勾兩個、看沒日期的樓層、算進第一天
await page.evaluate((data) => { window.__mix = data; }, MIX);
await page.route('**/api/chats/get', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MIX) }));
await page.click('[data-action="old-read"]');
await page.waitForFunction(() => document.querySelector('[data-role="old-undated"]'));
await page.check('[data-role="old-date-src"][value="tag:tableEdit"]');
let txt = await page.textContent('[data-role="old-result"]');
check('UI: both sources ticked and counted', txt.includes('2 層的日期從 <details> 標籤讀到') && txt.includes('1 層的日期從 <tableEdit> 標籤讀到') && (await page.$$('[data-role="old-date-src"]:checked')).length === 2, txt.replace(/\s+/g, ' ').slice(0, 300));
await page.click('[data-action="old-undated-toggle"]');
txt = await page.textContent('[data-role="old-undated"]');
check('UI: undated floors shown', txt.includes('找不到日期的樓層（2）') && txt.includes('#1') && txt.includes('開場白'), txt.replace(/\s+/g, ' ').slice(0, 300));
await page.click('[data-action="old-days-toggle"]');
check('UI: day rows show floor numbers', (await page.textContent('[data-date="2025-03-02"] [data-role="old-floors"]')).trim() === '#7');
await page.locator('[data-role="old-result"]').screenshot({ path: `${OUT}/olddates-mix.png` });
await page.check('[data-role="old-lead-in"]');
txt = await page.textContent('[data-role="old-result"]');
check('UI: lead-in moves them into the first day', txt.includes('2 層在聊天開頭') && (await page.textContent('[data-action="diary-start"]')).includes('3 天') && (await page.textContent('[data-date="2025-03-01"] [data-role="old-floors"]')).trim() === '#1–5', txt.replace(/\s+/g, ' ').slice(0, 300));

const missing = await page.evaluate(async () => (await import('/src/i18n.js')).missingKeys());
check('i18n keys complete', !missing.length, JSON.stringify(missing));
for (const l of results) console.log(l);
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
