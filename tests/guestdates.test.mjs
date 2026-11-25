// 🏨 客人簿 × 行事曆（v0.13.70）：入住＝新增那一層的日期、退房＝記離開那一層的日期；
// 月曆格子有 🏨、點那天列出誰入住／退房；客人簿顯示日期和住了幾晚；換了曆法時給模型的說明也照故事的曆法。
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [execSync('npm root -g').toString().trim()] }));

const OUT = process.argv[2] ?? '.';
const URL = `http://127.0.0.1:${process.env.PORT ?? 8765}/tests/harness.html`;
const results = [];
const errors = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

// 虛構的小旅店：沈言和小雨經營；阿青住兩晚走了、過幾天又來，老周一直住著。
const ai = (mes) => ({ name: '沈言', is_user: false, mes, send_date: 'x', extra: {}, swipe_id: 0, swipes: [mes], swipe_info: [{ extra: {} }] });
const user = (mes) => ({ name: '小雨', is_user: true, mes, send_date: 'x', extra: {} });
const CHAT = [user('開店吧。'), ai('阿青和老周住了進來。'), user('早。'), ai('阿青結帳走了。'), user('嗯。'), ai('阿青又來了。')];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text()); });
await page.addInitScript((chat) => { window.__chat = chat; }, CHAT);
await page.goto(URL);
await page.waitForFunction(() => document.getElementById('lp_wand_entry'));

// 自訂曆法、開客人簿；給模型的說明
const rules = await page.evaluate(async () => {
    const s = (await import('/src/settings.js')).getSettings();
    s.calendar.enabled = true;
    (await import('/src/calendars.js')).setCalStyle({ type: 'custom', months: '晨露月、烈陽月、落葉月、寒雪月', monthDays: 30 });
    (await import('/src/guests.js')).setGuestBook({ on: true });
    return (await import('/src/l1rules.js')).buildL1Parts({ length: 80, char: '沈言', user: '小雨' }).rules;
});
check('guest dates follow story calendar in prompt', rules.includes('欄位裡的日期（入住、退房…）照上面的曆法寫，例如「晨露月1日 傍晚」'), rules.slice(rules.indexOf('guest（'), rules.indexOf('guest（') + 600));

// 三層摘要：新增、離開、又來了
const flow = await page.evaluate(async () => {
    const sum = await import('/src/summarize.js');
    const notes = await import('/src/notes.js');
    const base = { time: '', location: '', characters: [], events: [], keepsakes: [], prefs: [] };
    const apply = (i, date, ops) => {
        notes.invalidateNotes();
        sum.applyL1Result(i, { ...base, summary: `第${i}層`, date, ops }, { notesBefore: new Map(notes.getNotes().notes), hash: `h${i}`, by: 'x' });
    };
    apply(1, '3-4-12', [
        { op: 'add', type: 'guest', data: { '名字': '阿青', '房間': '一號房' } },
        { op: 'add', type: 'guest', data: { '名字': '老周', '房間': '二號房' } },
    ]);
    notes.invalidateNotes();
    const id = [...notes.getNotes().notes.values()].find((n) => n.data.name === '阿青').id;
    apply(3, '3-4-14', [{ op: 'complete', id, result: 'done', detail: '住了兩晚，付清了。' }]);
    apply(5, '3-4-20', [{ op: 'add', type: 'guest', data: { '名字': '阿青', '房間': '三號房' } }]);
    notes.invalidateNotes();
    const nd = await import('/src/notedates.js');
    const all = [...notes.getNotes().notes.values()];
    const a = all.find((n) => n.data.name === '阿青');
    const z = all.find((n) => n.data.name === '老周');
    return { a: nd.guestStays(a), z: nd.guestStays(z), visits: a.visits };
});
const D = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    const t = new Date(Date.UTC(2001, 0, 1) + ((y - 1) * 120 + (m - 1) * 30 + (d - 1)) * 86400000);
    return t.toISOString().slice(0, 10);
};
check('first stay dated by floors', flow.a[0]?.from === D('3-4-12') && flow.a[0]?.to === D('3-4-14') && !flow.a[0].current, JSON.stringify(flow.a));
check('second stay starts on the return floor', flow.a.length === 2 && flow.a[1].from === D('3-4-20') && flow.a[1].to === '' && flow.a[1].current && flow.visits === 2, JSON.stringify(flow.a));
check('staying guest has no check-out', flow.z.length === 1 && flow.z[0].from === D('3-4-12') && flow.z[0].current, JSON.stringify(flow.z));

// 大視窗：月曆的 🏨、點那天的清單
await page.evaluate(() => { document.getElementById('extensionsMenu').style.display = ''; });
await page.click('#lp_wand_entry');
await page.click('[data-tab="notes"]');
await page.waitForTimeout(200);
const cell = (iso) => page.evaluate((iso) => {
    const b = document.querySelector(`.lp-cal-cell[data-date="${iso}"]`);
    return b ? { marks: b.querySelector('.lp-cal-marks').textContent, label: b.getAttribute('aria-label') } : null;
}, iso);
const c12 = await cell(D('3-4-12'));
const c14 = await cell(D('3-4-14'));
const c13 = await cell(D('3-4-13'));
check('check-in day marked', c12?.marks.includes('🏨') && c12.label.includes('入住：') && c12.label.includes('阿青') && c12.label.includes('老周'), JSON.stringify(c12));
check('check-out day marked', c14?.marks.includes('🏨') && c14.label.includes('退房：阿青'), JSON.stringify(c14));
check('plain day not marked', c13 && !c13.marks.includes('🏨'), JSON.stringify(c13));
await page.click(`.lp-cal-cell[data-date="${D('3-4-14')}"]`);
const day = await page.textContent('[data-role="cal-day-out"]').catch(() => '');
check('day view lists check-out', day.includes('🚪') && day.includes('阿青'), day);
await page.screenshot({ path: `${OUT}/guestdates-1-calendar.png` });

// 點名字打開客人簿那一條
await page.click('[data-role="cal-day-out"] [data-action="cal-guest"]');
await page.waitForTimeout(200);
const tab = await page.evaluate(() => document.querySelector('.lp-tab.lp-on')?.dataset.tab);
const here = await page.textContent('[data-role="guests-here"]');
check('opens guest book', tab === 'guests' && here.includes('阿青'), tab);
check('card shows this stay', here.includes('這次住') && here.includes('寒雪月20日 剛入住'), here.replace(/\s+/g, ' ').slice(0, 400));
check('past stay with dates and nights', here.includes('第 1 次') && here.includes('寒雪月12日 → 寒雪月14日・2 晚'), here.replace(/\s+/g, ' ').slice(0, 500));
await page.screenshot({ path: `${OUT}/guestdates-2-book.png` });

// 老周：住到今天（寒雪月20日）→ 住了 8 晚
const head = await page.$$('[data-role="guests-here"] .lp-row-head');
for (const h of head) if ((await h.getAttribute('aria-expanded')) !== 'true') await h.click();
const here2 = await page.textContent('[data-role="guests-here"]');
check('staying guest nights so far', here2.includes('寒雪月12日 入住・住了 8 晚'), here2.replace(/\s+/g, ' ').slice(0, 600));

// 西曆：照樣有日期，說明裡沒有那句
const greg = await page.evaluate(async () => {
    (await import('/src/calendars.js')).setCalStyle({ type: 'gregorian' });
    return (await import('/src/l1rules.js')).buildL1Parts({ length: 80, char: '沈言', user: '小雨' }).rules;
});
check('no story-calendar line for gregorian', !greg.includes('照上面的曆法寫'));

await browser.close();
console.log(results.join('\n'));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
if (results.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
