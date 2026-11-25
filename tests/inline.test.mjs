// 主模型順手寫（v0.13.67）：說明放在提示詞最後；回覆裡的紀錄拆出來存成這一層的摘要、從正文拿掉；
// 沒寫或寫壞標失敗、跳通知（不自動另外呼叫）；繼續寫沒附紀錄時原本的摘要留著。
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [execSync('npm root -g').toString().trim()] }));

const URL = `http://127.0.0.1:${process.env.PORT ?? 8765}/tests/harness.html`;
const results = [];
const errors = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

const user = (i, mes) => ({ name: '小雨', is_user: true, mes, send_date: `d${i}`, extra: {} });
const ai = (i, mes) => ({ name: '沈言', is_user: false, mes, send_date: `d${i}`, extra: {}, swipe_id: 0, swipes: [mes], swipe_info: [{ extra: {} }] });
const record = (summary, extra = {}) => `<!--lovers_planner\n${JSON.stringify({ time: '傍晚', location: '海城・碼頭', characters: ['沈言', '小雨'], summary, ops: [], ...extra })}\n-->`;

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.addInitScript((chat) => { window.__chat = chat; }, [user(0, '我們去碼頭吧。'), ai(1, '他牽起她的手，往碼頭走去。')]);
await page.goto(URL);
await page.waitForFunction(() => document.getElementById('lp_wand_entry'));
await page.evaluate(async () => {
    const s = (await import('/src/settings.js')).getSettings();
    s.summary.mode = 'inline';
    window.__toasts = [];
    const tt = globalThis.toastr ??= {};
    for (const k of ['info', 'success', 'warning', 'error']) tt[k] = (html) => { window.__toasts.push(String(html)); return null; };
});

// 1. 生成時：說明放在最後（深度 0、system），寫著格式
await page.evaluate(() => window.__runInterceptor('normal'));
const p = await page.evaluate(() => window.__extPrompts.lovers_planner_inline);
check('instruction at depth 0', p && p.depth === 0 && p.position === 1 && p.role === 0, JSON.stringify(p && { d: p.depth, pos: p.position }));
check('instruction has format', p?.value.includes('<!--lovers_planner') && p.value.includes('"summary"') && p.value.includes('-->'), p?.value.slice(0, 80));
check('instruction mentions previous floor', p?.value.includes('上一'));
// v0.13.71：等狀態欄、選項這些模組都寫完才寫紀錄，紀錄後面不再有東西
check('instruction: after all modules', p?.value.includes('全部寫完') && p.value.includes('狀態欄') && p.value.includes('紀錄後面不要再寫任何東西'), p?.value.slice(0, 160));
// 模型還是把紀錄寫在模組前面：拆掉紀錄，後面的模組留著
const mid = await page.evaluate(async () => (await import('/src/inline.js')).extractInline('正文。\n\n<!--lovers_planner {"summary":"x"} -->\n\n【狀態欄】心情：好'));
check('record before modules: modules kept', mid?.inner === '{"summary":"x"}' && mid.rest === '正文。\n\n【狀態欄】心情：好', JSON.stringify(mid));
// 背景的安靜生成不加
await page.evaluate(() => window.__runInterceptor('quiet'));
check('quiet: no instruction', !(await page.evaluate(() => window.__extPrompts.lovers_planner_inline?.value)));

// 2. 回覆帶紀錄：拆出來存好，正文拿掉
const reply = '她笑著跟上，海風很大。\n\n' + record('沈言和小雨傍晚到碼頭散步。');
await page.evaluate(async (mes) => {
    window.__chat.push({ name: '小雨', is_user: true, mes: '好冷。', send_date: 'd2', extra: {} });
    window.__chat.push({ name: '沈言', is_user: false, mes, send_date: 'd3', extra: {}, swipe_id: 0, swipes: [mes], swipe_info: [{ extra: {} }] });
    await window.__emit('message_received', 3);
}, reply);
let st = await page.evaluate(async () => {
    const c = await import('/src/chat.js');
    return { mes: window.__chat[3].mes, swipe: window.__chat[3].swipes[0], e: c.getEntry(3), status: c.floorStatus(3), calls: window.__prompts.length };
});
check('block removed from text', st.mes === '她笑著跟上，海風很大。' && st.swipe === st.mes, JSON.stringify(st.mes));
check('stored as summary', st.e?.status === 'ok' && st.e.summary === '沈言和小雨傍晚到碼頭散步。' && st.e.location === '海城・碼頭' && st.status === 'ok', JSON.stringify(st.e));
check('by main model', st.e?.by === '主模型・順手寫');
check('no extra model call', st.calls === 0, String(st.calls));
check('stored on the swipe too', await page.evaluate(() => Boolean(window.__chat[3].swipe_info[0].extra.lovers_planner?.summary)));

// 3. 模型改寫成標籤、包在 ``` 裡也認得
await page.evaluate(async () => {
    const mes = '他把外套披到她身上。\n```\n<lovers_planner>\n{"summary":"沈言把外套給小雨。","ops":[]}\n</lovers_planner>\n```';
    window.__chat.push({ name: '小雨', is_user: true, mes: '謝謝。', send_date: 'd4', extra: {} });
    window.__chat.push({ name: '沈言', is_user: false, mes, send_date: 'd5', extra: {}, swipe_id: 0, swipes: [mes], swipe_info: [{ extra: {} }] });
    await window.__emit('message_received', 5);
});
st = await page.evaluate(async () => ({ mes: window.__chat[5].mes, e: (await import('/src/chat.js')).getEntry(5) }));
check('tag + fence form', st.mes === '他把外套披到她身上。' && st.e?.summary === '沈言把外套給小雨。', JSON.stringify(st));

// 4. 沒寫：標失敗、跳通知（有「另外摘要」），沒有自動呼叫
await page.evaluate(async () => {
    window.__toasts.length = 0;
    window.__chat.push({ name: '小雨', is_user: true, mes: '回家吧。', send_date: 'd6', extra: {} });
    window.__chat.push({ name: '沈言', is_user: false, mes: '他點點頭。', send_date: 'd7', extra: {}, swipe_id: 0, swipes: ['他點點頭。'], swipe_info: [{ extra: {} }] });
    await window.__emit('message_received', 7);
});
st = await page.evaluate(async () => ({ e: (await import('/src/chat.js')).getEntry(7), toasts: window.__toasts.slice(), calls: window.__prompts.length }));
check('missing → fail', st.e?.status === 'fail' && st.e.error.includes('沒有附上紀錄'), JSON.stringify(st.e));
check('missing → toast with button', st.toasts.some((h) => h.includes('第 7 層') && h.includes('另外摘要')), st.toasts.join(' | ').slice(0, 120));
check('missing → no auto call', st.calls === 0);
// 按「另外摘要」→ 走原本的摘要
await page.evaluate(async () => {
    (await import('/src/summarize.js')).enqueue(7, { front: true });
    await (await import('/src/summarize.js')).waitForIdle(5000);
});
st = await page.evaluate(async () => ({ e: (await import('/src/chat.js')).getEntry(7), calls: window.__prompts.length }));
check('separate summary works', st.e?.status === 'ok' && st.calls === 1, JSON.stringify(st.e?.status));

// 5. 寫壞（JSON 看不懂）也標失敗、跳通知
await page.evaluate(async () => {
    window.__toasts.length = 0;
    const mes = '夜深了。\n<!--lovers_planner\n{"summary": \n-->';
    window.__chat.push({ name: '小雨', is_user: true, mes: '晚安。', send_date: 'd8', extra: {} });
    window.__chat.push({ name: '沈言', is_user: false, mes, send_date: 'd9', extra: {}, swipe_id: 0, swipes: [mes], swipe_info: [{ extra: {} }] });
    await window.__emit('message_received', 9);
});
st = await page.evaluate(async () => ({ mes: window.__chat[9].mes, e: (await import('/src/chat.js')).getEntry(9), toasts: window.__toasts.slice() }));
check('broken → fail + text cleaned', st.e?.status === 'fail' && st.mes === '夜深了。' && st.toasts.some((h) => h.includes('第 9 層')), JSON.stringify(st.e));

// 6. 繼續寫、沒附新紀錄：原本的摘要留著（顯示過期），跳通知
await page.evaluate(async () => {
    window.__toasts.length = 0;
    window.__chat[3].mes += '\n她靠在他肩上。';
    window.__chat[3].swipes[0] = window.__chat[3].mes;
    await window.__emit('message_received', 3);
});
st = await page.evaluate(async () => { const c = await import('/src/chat.js'); return { e: c.getEntry(3), status: c.floorStatus(3), toasts: window.__toasts.slice() }; });
check('continue without record keeps old', st.e?.summary === '沈言和小雨傍晚到碼頭散步。' && st.status === 'stale' && st.toasts.some((h) => h.includes('第 3 層')), JSON.stringify({ s: st.status }));

// 7. 別的模式：說明清掉、回覆裡的東西不動
await page.evaluate(async () => { (await import('/src/settings.js')).getSettings().summary.mode = 'manual'; });
// （前面故意弄出失敗、過期的樓層，跑整個攔截器會跳「這幾層要怎麼處理」的彈窗等人按；這裡只跑順手寫那一段）
await page.evaluate(async () => (await import('/src/inline.js')).prepareInline('normal'));
check('other mode clears instruction', !(await page.evaluate(() => window.__extPrompts.lovers_planner_inline?.value)));
const untouched = await page.evaluate(async () => {
    const mes = '早安。\n<!--lovers_planner\n{"summary":"x"}\n-->';
    window.__chat.push({ name: '小雨', is_user: true, mes: '早。', send_date: 'd10', extra: {} });
    window.__chat.push({ name: '沈言', is_user: false, mes, send_date: 'd11', extra: {}, swipe_id: 0, swipes: [mes], swipe_info: [{ extra: {} }] });
    await window.__emit('message_received', 11);
    return window.__chat[11].mes === mes;
});
check('other mode leaves reply alone', untouched);

// 8. 設定頁有這個選項；三種語言的字都有
const opts = await page.evaluate(async () => {
    const i18n = await import('/src/i18n.js');
    return { missing: i18n.missingKeys() };
});
check('i18n keys complete', !Object.keys(opts.missing).length, JSON.stringify(opts.missing).slice(0, 200));

await browser.close();
console.log(results.join('\n'));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
if (results.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
