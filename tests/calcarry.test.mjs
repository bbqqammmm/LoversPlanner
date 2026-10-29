// 📅 補帶行事曆（v0.13.38，使用者回報：v0.13.33 以前開的新聊天，生理期沒有帶過去）：
// 這個聊天是從別的聊天帶來的、但沒帶到行事曆 → 行事曆上方提醒，按一下直接讀那個聊天檔補帶；補過或說不用就不再問。
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [execSync('npm root -g').toString().trim()] }));

const OUT = process.argv[2] ?? '.';
const URL = `http://127.0.0.1:${process.env.PORT ?? 8765}/tests/harness.html`;
const results = [];
const errors = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

const lp = (date, events) => ({ lovers_planner: { v: 2, status: 'ok', summary: 's', date, events, ops: [], at: 1, hash: 'x' } });
const OLD = [{ user_name: '小雨', character_name: '沈言', chat_metadata: {} },
  { name: '小雨', is_user: true, mes: 'a', send_date: 'o0' },
  { name: '沈言', is_user: false, mes: 'b', send_date: 'o1', extra: lp('2025-04-01', [{ type: 'period', state: 'start' }]) },
  { name: '小雨', is_user: true, mes: 'c', send_date: 'o2' },
  { name: '沈言', is_user: false, mes: 'd', send_date: 'o3', extra: lp('2025-04-05', [{ type: 'period', state: 'end' }, { type: 'intimacy', count: 2 }, { type: 'anniversary', date: '04-05', title: '在一起紀念日' }]) }];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text()); });
let reads = 0;
await page.route('**/api/chats/get', (r) => { reads++; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OLD) }); });
await page.addInitScript(() => {
  window.__chatId = '新聊天';
  window.__chat = Array.from({ length: 4 }, (_, i) => ({ name: i % 2 ? '沈言' : '小雨', is_user: !(i % 2), mes: `第${i}則`, send_date: `c${i}`, extra: {} }));
  window.__toasts = [];
  window.toastr = { success: (m) => window.__toasts.push(m), info: (m) => window.__toasts.push(m), warning: (m) => window.__toasts.push(m), error: (m) => window.__toasts.push(m) };
  window.__presetSettings = { lovers_planner: { settingsVersion: 5, summary: { mode: 'manual' }, ui: { seenVersion: '9.9.9' }, backup: { auto: false } } };
});
await page.goto(URL);
await page.waitForFunction(() => Boolean(globalThis.loversPlannerInterceptor));
// 以前帶過來的：有 carry 記錄，但沒有行事曆
await page.evaluate(() => {
  window.__chatMetadata.lovers_planner = { ...(window.__chatMetadata.lovers_planner ?? {}), carry: { source: '舊聊天', at: 1, undo: {}, kinds: { summary: 'copy' } }, linkInit: 1 };
  document.getElementById('extensionsMenu').style.display = '';
  document.getElementById('lp_wand_entry').click();
});
await page.click('[data-tab="notes"]');
await page.waitForSelector('[data-role="cal-carry"]');
check('asks to bring the calendar over', (await page.textContent('[data-role="cal-carry"]')).includes('從「舊聊天」帶過來的'));
await page.locator('[data-role="cal-carry"]').screenshot({ path: `${OUT}/calcarry.png` });
await page.click('[data-action="cal-carry"]');
await page.waitForFunction(() => !document.querySelector('[data-role="cal-carry"]'), null, { timeout: 10000 });
const cal = await page.evaluate(async () => { const c = (await import('/src/calendar.js')).buildCalendar(); return { periods: c.periods, carried: c.items.filter((x) => x.source === 'carried').map((x) => `${x.type}:${x.date}:${x.from}`) }; });
check('period, intimacy and anniversary brought over', JSON.stringify(cal.periods) === '[{"start":"2025-04-01","end":"2025-04-05","open":false}]' && cal.carried.length === 4 && cal.carried.every((x) => x.endsWith(':舊聊天')), JSON.stringify(cal));
check('toast tells how many', await page.evaluate(() => window.__toasts.some((x) => String(x).includes('帶進了 4 筆：生理期 1 次、親熱 2 次、紀念日 1 個'))), JSON.stringify(await page.evaluate(() => window.__toasts)));
check('diary reader state untouched', !(await page.evaluate(async () => (await import('/src/oldchats.js')).hasLoadedDays())));
// 不再問；重新整理大視窗也一樣
await page.click('[data-tab="summary"]');
await page.click('[data-tab="notes"]');
check('not asked again', !(await page.$('[data-role="cal-carry"]')) && reads === 1);

// 「不用」：記下來，不再問
await page.evaluate(() => {
  const m = window.__chatMetadata.lovers_planner;
  m.calendar.carried = [];
  m.calendar.carryAsked = [];
  m.carry.source = '另一個聊天';
});
await page.click('[data-tab="summary"]');
await page.click('[data-tab="notes"]');
await page.click('[data-action="cal-carry-no"]');
check('"no thanks" remembered', !(await page.$('[data-role="cal-carry"]')) && reads === 1);

const missing = await page.evaluate(async () => (await import('/src/i18n.js')).missingKeys());
check('i18n keys complete', !missing.length, JSON.stringify(missing));
for (const l of results) console.log(l);
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
