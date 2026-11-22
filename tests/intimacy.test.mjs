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


// ===== 新的記法（v0.13.66）：親熱中 → 完成（男方高潮）／沒完成；一天好幾場 =====
const st = (date, state, count) => ({ status: 'ok', summary: '…', date, events: [{ type: 'intimacy', state, ...(count ? { count } : {}) }] });
const NEW = [
  ai(0, st('2025-04-01', 'ongoing')), user(1), ai(2, st('', 'ongoing')), user(3), ai(4, st('', 'done', 1)), user(5), // 一場，完成 1 次
  ai(6, st('', 'ongoing')), user(7), ai(8, st('', 'stopped')), user(9),                                               // 被打斷：不算次數
  ai(10, st('', 'done', 2)), user(11),                                                                                // 一層裡兩次
  ai(12, st('', 'ongoing')),                                                                                          // 最新一層還在進行
];
const p2 = await browser.newPage();
p2.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await p2.addInitScript((chat) => { window.__chat = chat; }, NEW);
await p2.goto(URL);
await p2.waitForFunction(() => document.getElementById('lp_wand_entry'));
await p2.evaluate(async () => {
  const s = (await import('/src/settings.js')).getSettings();
  s.calendar.enabled = true;
  s.calendar.track = { ...s.calendar.track, intimacy: true };
});
const info = await p2.evaluate(async () => {
  const c = await import('/src/calendar.js');
  const cal = c.buildCalendar();
  const d = c.dayInfo(cal, '2025-04-01');
  return {
    n: d.intimacy, ongoing: d.intimacyOngoing, stopped: d.intimacyStopped, calOngoing: cal.ongoing,
    items: cal.items.filter((x) => x.type === 'intimacy').map((x) => `${x.state}:${x.count}:${x.floors.join('+')}`),
    inject: c.calendarInjection(), carry: c.carryItems('雨天').filter((x) => x.type === 'intimacy').map((x) => `${x.state}:${x.count}`),
  };
});
check('scenes: done after ongoing, stopped, done x2, still ongoing', info.items.join() === 'done:1:0+2+4,stopped:0:6+8,done:2:10,ongoing:0:12', info.items.join());
check('day counts only finished times', info.n === 3, String(info.n));
check('day knows a scene was stopped and one is going on', info.stopped === 1 && info.ongoing === true);
check('ongoing scene told to the character', info.calOngoing?.floor === 12 && info.inject.includes('現在正在親熱') && info.inject.includes('今天已經親熱過 3 次'), info.inject);
check('carry keeps finished and stopped, not ongoing', info.carry.join() === 'done:1,stopped:0,done:2', info.carry.join());
// 親熱中、下一層卻沒再提到 → 當成沒完成
await p2.evaluate(() => { window.__chat.push({ name: '小雨', is_user: true, mes: 'U13', extra: {} }, { name: '沈言', is_user: false, mes: 'AI14', send_date: 'd14', extra: { lovers_planner: { status: 'ok', summary: '…', date: '', events: [] } }, swipe_id: 0, swipes: ['AI14'], swipe_info: [{ extra: {} }] }); });
const after = await p2.evaluate(async () => {
  const c = await import('/src/calendar.js');
  const cal = c.buildCalendar();
  return { last: cal.items.filter((x) => x.type === 'intimacy').at(-1).state, ongoing: cal.ongoing, inject: c.calendarInjection() };
});
check('ongoing then silence → stopped', after.last === 'stopped' && after.ongoing === null && !after.inject.includes('現在正在親熱'), JSON.stringify(after));
// 摘要區塊的文字
const labels = await p2.evaluate(async () => {
  const m = await import('/src/ui/message.js');
  return ['ongoing', 'stopped', 'done'].map((state) => m.eventLabel({ type: 'intimacy', state, count: 2 }));
});
check('labels', labels.join('|') === '💕 親熱中|🤍 親熱過（沒完成）|💕 親熱 2 次', labels.join('|'));
const rules2 = await p2.evaluate(async () => (await import('/src/l1rules.js')).buildL1Parts({ length: 80, char: '沈言', user: '小雨' }));
check('prompt asks for state', rules2.rules.includes('ongoing') && rules2.rules.includes('stopped') && rules2.format.includes('"state": "ongoing|done|stopped"'));
const cleaned = await p2.evaluate(async () => (await import('/src/calendar.js')).cleanEvents([{ type: 'intimacy', state: 'ongoing', count: 3 }, { type: 'intimacy', state: 'done' }, { type: 'intimacy', count: 2 }]));
check('cleanEvents keeps state; old style still works', JSON.stringify(cleaned) === JSON.stringify([{ type: 'intimacy', state: 'ongoing' }, { type: 'intimacy', state: 'done', count: 1 }, { type: 'intimacy', count: 2 }]), JSON.stringify(cleaned));

await browser.close();
console.log(results.join('\n'));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
if (results.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
