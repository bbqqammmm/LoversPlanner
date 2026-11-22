// 行事曆的親熱次數：同一場分好幾層寫只算一次（使用者回報：八層寫一場記成八次）。
// 連續幾層都有、同一天 → 一場；中間有一層沒有、或換了一天 → 新的一場；失敗的樓層不打斷。刪掉時整場一起刪。
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [execSync('npm root -g').toString().trim()] }));

const URL = `http://127.0.0.1:${process.env.PORT ?? 8765}/tests/harness.html`;
const results = [];
const errors = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

const ai = (i, lp) => ({ name: '沈言', is_user: false, mes: `AI${i}`, send_date: `d${i}`, extra: { lovers_planner: lp }, swipe_id: 0, swipes: [`AI${i}`], swipe_info: [{ extra: { lovers_planner: lp } }] });
const user = (i) => ({ name: '小雨', is_user: true, mes: `U${i}`, extra: {} });
const hug = (date, count = 1) => ({ status: 'ok', summary: '…', date, events: [{ type: 'intimacy', count }] });
const plain = (date) => ({ status: 'ok', summary: '…', date, events: [] });
const CHAT = [
  ai(0, hug('2025-03-02')), user(1), ai(2, hug('', 1)), user(3), ai(4, hug('', 2)), user(5), ai(6, hug('')), user(7), // 一場，最多 2 次
  ai(8, plain('')), user(9),                                                                                        // 中間沒有 → 斷開
  ai(10, hug('')), user(11),                                                                                        // 同一天的第二場
  ai(12, hug('2025-03-03')), user(13),                                                                              // 換一天 → 新的一場
  ai(14, { status: 'fail' }), user(15), ai(16, hug('')),                                                            // 失敗的樓層不打斷
];

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.addInitScript((chat) => { window.__chat = chat; }, CHAT);
await page.goto(URL);
await page.waitForFunction(() => document.getElementById('lp_wand_entry'));
await page.evaluate(async () => {
  const s = (await import('/src/settings.js')).getSettings();
  s.calendar.enabled = true;
  s.calendar.track = { ...s.calendar.track, intimacy: true };
});
const day = (d) => page.evaluate(async (d) => {
  const c = await import('/src/calendar.js');
  const cal = c.buildCalendar();
  return { n: c.dayInfo(cal, d).intimacy, items: cal.items.filter((x) => x.type === 'intimacy' && x.date === d).map((x) => ({ floors: x.floors, count: x.count, key: x.key })) };
}, d);

let d2 = await day('2025-03-02');
check('one scene over four floors counts once (max count 2)', d2.items.length === 2 && d2.items[0].floors.join() === '0,2,4,6' && d2.items[0].count === 2, JSON.stringify(d2.items));
check('a floor without it starts a new scene', d2.items[1].floors.join() === '10');
check('day total', d2.n === 3, String(d2.n));
const d3 = await day('2025-03-03');
check('new day is a new scene; failed floor does not break it', d3.items.length === 1 && d3.items[0].floors.join() === '12,16' && d3.n === 1, JSON.stringify(d3));

// 刪掉合成的那一場：整場都刪，不會剩下後面幾層變成新的一場
await page.evaluate(async (key) => (await import('/src/calendar.js')).removeEvent({ source: 'floor', key }), d2.items[0].key);
d2 = await day('2025-03-02');
check('removing a merged scene removes all its floors', d2.items.length === 1 && d2.items[0].floors.join() === '10' && d2.n === 1, JSON.stringify(d2.items));

// 提示詞說明連續的幾層會合成一次
const rules = await page.evaluate(async () => (await import('/src/l1rules.js')).buildL1Parts({ length: 80, char: '沈言', user: '小雨' }).rules);
check('prompt explains merging', rules.includes('合成一次'));

await browser.close();
console.log(results.join('\n'));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
if (results.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
