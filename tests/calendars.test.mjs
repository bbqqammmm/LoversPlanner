// 曆法（v0.13.68）：西曆以外的故事日期（中式農曆、每月 30 天、自訂、只記第幾天）。
// 裡面照舊用 YYYY-MM-DD 數日子；換掉的是讀日期、顯示、月曆、紀念日、給模型的說明。跟著角色卡。
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [execSync('npm root -g').toString().trim()] }));

const URL = `http://127.0.0.1:${process.env.PORT ?? 8765}/tests/harness.html`;
const results = [];
const errors = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.addInitScript(() => {
    window.__chat = [
        { name: '小雨', is_user: true, mes: '開店吧。', send_date: 'd0', extra: {} },
        { name: '沈言', is_user: false, mes: '他推開酒館的門。', send_date: 'd1', extra: {}, swipe_id: 0, swipes: ['x'], swipe_info: [{ extra: {} }] },
    ];
});
await page.goto(URL);
await page.waitForFunction(() => document.getElementById('lp_wand_entry'));

// ===== 1. 換算 =====
const conv = await page.evaluate(async () => {
    const c = await import('/src/calendars.js');
    const L = { type: 'lunar', era: '天啟', months: [], monthDays: 30 };
    const F = { type: 'fixed30', era: '', months: [], monthDays: 30 };
    const C = { type: 'custom', era: '', months: ['晨露月', '烈陽月', '落葉月', '寒雪月'], monthDays: 30, yearLabel: '' };
    const D = { type: 'days', era: '', months: [], monthDays: 30 };
    // 農曆：隨機日子來回換算
    let roundTrip = true;
    for (let k = 0; k < 400; k++) {
        const iso = new Date(Date.UTC(2001, 1, 1) + Math.floor(Math.random() * 36000) * 86400000).toISOString().slice(0, 10);
        const p = c.isoToParts(iso, L);
        if (!p || c.partsToIso(p, L) !== iso) { roundTrip = false; break; }
    }
    return {
        lunarNewYear: c.partsToIso({ y: 1, m: 1, d: 1 }, L), // 農曆 2001 年正月初一＝2001-01-24
        lunarLeap: c.partsToIso({ y: 1, m: 4, d: 5, leap: true }, L), // 2001 年閏四月
        lunarNoLeap: c.partsToIso({ y: 2, m: 4, d: 5, leap: true }, L), // 2002 年沒有閏月
        roundTrip,
        fixedFirst: c.partsToIso({ y: 1, m: 1, d: 1 }, F),
        fixedNextYear: c.partsToIso({ y: 2, m: 1, d: 1 }, F),
        fixedBad: c.partsToIso({ y: 1, m: 2, d: 31 }, F),
        customYear2: c.partsToIso({ y: 2, m: 1, d: 1 }, C),
        customBadMonth: c.partsToIso({ y: 1, m: 5, d: 1 }, C),
        days12: c.partsToIso({ d: 12 }, D),
        // 讀
        code: c.parseStoryDate('3-4-12', '', C),
        text: c.parseStoryDate('第3年寒雪月12日', '', C),
        noYear: c.parseStoryDate('寒雪月12日', c.partsToIso({ y: 3, m: 2, d: 1 }, C), C),
        rollYear: c.parseStoryDate('晨露月2日', c.partsToIso({ y: 3, m: 4, d: 20 }, C), C),
        cnText: c.parseStoryDate('天啟三年三月初五', '', L),
        cnNoYear: c.parseStoryDate('臘月廿三', c.partsToIso({ y: 3, m: 3, d: 5 }, L), L),
        leapText: c.parseStoryDate('閏四月初五', c.partsToIso({ y: 1, m: 2, d: 1 }, L), L),
        leapCode: c.parseStoryDate('1-閏4-5', '', L),
        dayText: c.parseStoryDate('第12天', '', D),
        dayNum: c.parseStoryDate('12', '', D),
        bad: c.parseStoryDate('明天', '', C),
        // 顯示
        labelL: c.fullLabel(c.partsToIso({ y: 3, m: 3, d: 5 }, L), L),
        labelL1: c.fullLabel(c.partsToIso({ y: 1, m: 12, d: 23 }, L), L),
        labelF: c.fullLabel(c.partsToIso({ y: 2, m: 11, d: 30 }, F), F),
        labelC: c.fullLabel(c.partsToIso({ y: 3, m: 4, d: 12 }, C), C),
        labelD: c.fullLabel(c.partsToIso({ d: 12 }, D), D),
        codeL: c.storyCode(c.partsToIso({ y: 1, m: 4, d: 5, leap: true }, L), L),
        cellL: c.cellLabel(c.partsToIso({ y: 3, m: 3, d: 1 }, L), L) + '/' + c.cellLabel(c.partsToIso({ y: 3, m: 3, d: 15 }, L), L),
        // 紀念日
        annivC: c.parseMonthDay('寒雪月12日', C),
        annivL: c.parseMonthDay('三月初五', L),
        annivD: c.parseMonthDay('3-5', D),
        nextC: c.nextYearly('01-02', c.partsToIso({ y: 3, m: 4, d: 20 }, C), C) === c.partsToIso({ y: 4, m: 1, d: 2 }, C),
        // 月曆一頁
        pageC: c.monthDays(c.monthKeyOf(c.partsToIso({ y: 3, m: 4, d: 12 }, C), C), C).days.length,
        pageL: c.monthDays(c.monthKeyOf(c.partsToIso({ y: 1, m: 4, d: 5, leap: true }, L), L), L).days.length,
        titleC: c.monthTitleOf(c.partsToIso({ y: 3, m: 4, d: 12 }, C), C),
        nextPage: c.monthTitleOf(c.shiftMonthKey(c.monthKeyOf(c.partsToIso({ y: 3, m: 4, d: 12 }, C), C), 1, C), C),
        prevPageL: c.monthTitleOf(c.shiftMonthKey(c.monthKeyOf(c.partsToIso({ y: 1, m: 5, d: 2 }, L), L), -1, L), L),
    };
});
check('lunar new year 2001-01-24', conv.lunarNewYear === '2001-01-24', conv.lunarNewYear);
check('lunar leap month', conv.lunarLeap > '2001-05-01' && conv.lunarNoLeap === '', `${conv.lunarLeap} ${conv.lunarNoLeap}`);
check('lunar round trip', conv.roundTrip);
check('fixed30', conv.fixedFirst === '2001-01-01' && conv.fixedNextYear === '2001-12-27' && conv.fixedBad === '', JSON.stringify([conv.fixedFirst, conv.fixedNextYear, conv.fixedBad]));
check('custom 4×30', conv.customYear2 === '2001-05-01' && conv.customBadMonth === '', conv.customYear2);
check('days', conv.days12 === '2001-01-12');
check('read code + text', conv.code && conv.code === conv.text, JSON.stringify([conv.code, conv.text]));
check('no year → previous year', conv.noYear === conv.code);
check('no year, earlier → next year', conv.rollYear > conv.code, conv.rollYear);
check('chinese text', Boolean(conv.cnText) && conv.cnNoYear > conv.cnText, JSON.stringify([conv.cnText, conv.cnNoYear]));
check('leap text/code', conv.leapText === conv.lunarLeap && conv.leapCode === conv.lunarLeap, JSON.stringify([conv.leapText, conv.leapCode]));
check('day count read', conv.dayText === '2001-01-12' && conv.dayNum === '2001-01-12');
check('unreadable', conv.bad === '');
check('labels', conv.labelL === '天啟三年三月初五' && conv.labelL1 === '天啟元年臘月廿三' && conv.labelF === '第二年冬月三十' && conv.labelC === '第3年 寒雪月12日' && conv.labelD === '第12天',
    JSON.stringify([conv.labelL, conv.labelL1, conv.labelF, conv.labelC, conv.labelD]));
check('story code with leap', conv.codeL === '1-閏4-5', conv.codeL);
check('cell labels', conv.cellL === '三月/十五', conv.cellL);
check('anniversary month-day', conv.annivC === '04-12' && conv.annivL === '03-05' && conv.annivD === '', JSON.stringify([conv.annivC, conv.annivL, conv.annivD]));
check('next yearly', conv.nextC);
check('month pages', conv.pageC === 30 && (conv.pageL === 29 || conv.pageL === 30) && conv.titleC === '第3年 寒雪月' && conv.nextPage === '第4年 晨露月' && conv.prevPageL === '天啟元年 閏四月',
    JSON.stringify([conv.pageC, conv.pageL, conv.titleC, conv.nextPage, conv.prevPageL]));

// ===== 2. 跟著角色卡；給模型的說明 =====
const prompt = await page.evaluate(async () => {
    const s = (await import('/src/settings.js')).getSettings();
    s.calendar.enabled = true;
    s.calendar.track = { ...s.calendar.track, anniversary: true, intimacy: true };
    const c = await import('/src/calendars.js');
    c.setCalStyle({ type: 'custom', months: '晨露月、烈陽月、落葉月、寒雪月', monthDays: 30 });
    const saved = s.characters['shenyan.png'].calendarStyle;
    const { rules, format } = (await import('/src/l1rules.js')).buildL1Parts({ length: 80, char: '沈言', user: '小雨' });
    return { saved, rules, format };
});
check('saved on the character', prompt.saved?.type === 'custom', JSON.stringify(prompt.saved));
check('prompt describes calendar', prompt.rules.includes('1＝晨露月') && prompt.rules.includes('每月 30 天'), prompt.rules.slice(0, 120));
check('prompt has no YYYY-MM-DD', !prompt.rules.includes('YYYY-MM-DD') && !prompt.format.includes('YYYY-MM-DD') && prompt.format.includes('年-月-日'), prompt.format);
check('anniversary rule uses month-day', !prompt.rules.includes('MM-DD') && prompt.rules.includes('月-日'));

// ===== 3. 摘要寫進來、行事曆、送給角色 =====
const flow = await page.evaluate(async () => {
    const sum = await import('/src/summarize.js');
    sum.applyL1Result(1, { summary: '酒館開張。', time: '', location: '', characters: [], ops: [], date: '3-4-12', events: [{ type: 'anniversary', date: '4-15', title: '開張紀念日' }], keepsakes: [], prefs: [] }, { notesBefore: new Map(), hash: 'h', by: 'x' });
    const chat = await import('/src/chat.js');
    const cal = await import('/src/calendar.js');
    const built = cal.buildCalendar();
    return {
        stored: chat.getEntry(1).date,
        today: built.today,
        inject: cal.calendarInjection(),
        prevForModel: sum.previousSceneText(3),
    };
});
check('stored as internal date', /^\d{4}-\d{2}-\d{2}$/.test(flow.stored) && flow.stored === flow.today, flow.stored);
check('injection in story calendar', flow.inject.includes('今天是 第3年 寒雪月12日。') && flow.inject.includes('寒雪月15日'), flow.inject);
check('previous date shown to model', flow.prevForModel.includes('3-4-12（第3年 寒雪月12日）'), flow.prevForModel);

// ===== 4. 大視窗：月曆、紀念日、設定 =====
await page.evaluate(() => { document.getElementById('extensionsMenu').style.display = ''; });
await page.click('#lp_wand_entry');
await page.click('[data-tab="notes"]');
await page.waitForTimeout(200);
const ui = await page.evaluate(() => {
    const t = (sel) => document.querySelector(sel)?.textContent ?? '';
    return {
        title: t('[data-role="cal-title"]'),
        heads: document.querySelectorAll('.lp-cal-head').length,
        cells: [...document.querySelectorAll('.lp-cal-cell .lp-cal-num')].map((x) => x.textContent).slice(0, 3).join(','),
        count: document.querySelectorAll('.lp-cal-cell:not(.lp-cal-empty)').length,
        status: t('[data-role="cal-status"]'),
        anniv: t('[data-role="anniv"]'),
        monthSelect: [...document.querySelectorAll('[data-role="anniv-month"] option')].map((o) => o.textContent).join(','),
    };
});
check('calendar page title', ui.title === '第3年 寒雪月', ui.title);
check('no weekday header', ui.heads === 0, String(ui.heads));
check('30 cells', ui.count === 30 && ui.cells === '1,2,3', `${ui.count} ${ui.cells}`);
check('status today', ui.status.includes('故事裡的今天：第3年 寒雪月12日'), ui.status.slice(0, 60));
check('anniversary list', ui.anniv.includes('開張紀念日') && ui.anniv.includes('寒雪月15日'), ui.anniv.slice(0, 80));
check('anniversary month select', ui.monthSelect === '晨露月,烈陽月,落葉月,寒雪月', ui.monthSelect);

// 設定頁換曆法
await page.click('[data-tab="settings"]');
await page.click('details[data-sec="calendar"] > summary');
const set = await page.evaluate(async () => {
    const sel = document.querySelector('[data-cal-style="type"]');
    if (!sel) return { found: false };
    sel.value = 'lunar';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    const era = document.querySelector('[data-cal-style="era"]');
    const c = await import('/src/calendars.js');
    return { found: true, type: c.calStyle().type, era: Boolean(era), start: document.getElementById('lp-cal-start')?.type };
});
check('settings switch calendar', set.found && set.type === 'lunar' && set.era && set.start === 'text', JSON.stringify(set));

// ===== 5. 換回西曆：跟以前一樣 =====
const greg = await page.evaluate(async () => {
    (await import('/src/calendars.js')).setCalStyle({ type: 'gregorian' });
    const cal = await import('/src/calendar.js');
    return { label: cal.dayLabel('2026-03-05'), read: cal.readDate('2026年3月5日'), short: cal.shortDay('2026-03-05'), anniv: cal.normMonthDay('3/5') };
});
check('gregorian unchanged', greg.label === '2026-03-05（週四）' && greg.read === '2026-03-05' && greg.short === '03-05 週四' && greg.anniv === '03-05', JSON.stringify(greg));

await browser.close();
console.log(results.join('\n'));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
if (results.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
