// ⏰ 過期很久的約定／待辦（v0.13.39，使用者回報：從舊聊天帶來、當時沒標成完成的，顯示「已過 300 多天」）：
// 預定日期過了 7 天以上、還在進行中 → 上方提醒；一次標成已完成（約定＝已履行、待辦＝已完成），或先篩出來看，或不用。
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
await page.addInitScript(() => {
  window.__chat = Array.from({ length: 4 }, (_, i) => ({ name: i % 2 ? '沈言' : '小雨', is_user: !(i % 2), mes: `第${i}則`, send_date: `d${i}`, extra: {} }));
  window.__toasts = [];
  window.toastr = { success: (m) => window.__toasts.push(m), info: (m) => window.__toasts.push(m), warning: (m) => window.__toasts.push(m), error: (m) => window.__toasts.push(m) };
  window.__presetSettings = { lovers_planner: { settingsVersion: 5, summary: { mode: 'manual' }, ui: { seenVersion: '9.9.9' }, backup: { auto: false } } };
});
await page.goto(URL);
await page.waitForFunction(() => Boolean(globalThis.loversPlannerInterceptor));
await page.evaluate(async () => {
  const s = await import('/src/summarize.js');
  s.writeSummary(1, { summary: '早上', date: '2025-12-30' });
  s.writeSummary(3, { summary: '晚上', date: '2025-12-30' });
  window.__chat[1].extra.lovers_planner.ops = [
    { op: 'add', id: 'p_old', type: 'promise', data: { content: '週末去看展覽', due: '2025-12-12' } },
    { op: 'add', id: 't_old', type: 'todo', data: { content: '訂民宿', due: '2025-12-01' } },
    { op: 'add', id: 'p_new', type: 'promise', data: { content: '跨年看煙火', due: '2025-12-28' } },
    { op: 'add', id: 'p_none', type: 'promise', data: { content: '以後一起養貓' } },
  ];
  (await import('/src/notes.js')).invalidateNotes();
  document.getElementById('extensionsMenu').style.display = '';
  document.getElementById('lp_wand_entry').click();
});
await page.click('[data-tab="notes"]');
await page.waitForSelector('[data-role="overdue"]');
check('hint counts only long-overdue active ones', (await page.textContent('[data-role="overdue"]')).includes('有 2 條約定／待辦的預定日期已經過了 7 天以上'));
await page.click('[data-action="overdue-look"]');
check('"show them first" filters to overdue', await page.evaluate(() => document.querySelector('[data-filter="late"]')?.getAttribute('aria-pressed') === 'true'));
await page.click('[data-action="overdue-ask"]');
check('asks before marking', (await page.textContent('[data-role="overdue"]')).includes('要把這 2 條都標成已完成嗎'));
await page.locator('[data-role="overdue"]').screenshot({ path: `${OUT}/overdue.png` });
await page.click('[data-action="overdue-done"]');
const st = await page.evaluate(async () => Object.fromEntries([...(await import('/src/notes.js')).getNotes().notes.values()].map((n) => [n.id, `${n.state}:${n.result ?? ''}`])));
check('promise kept, todo done, recent and undated untouched', st.p_old === 'done:kept' && st.t_old === 'done:done' && st.p_new.startsWith('active') && st.p_none.startsWith('active'), JSON.stringify(st));
check('hint gone, toast shown', !(await page.$('[data-role="overdue"]')) && (await page.evaluate(() => window.__toasts.some((x) => String(x).includes('標好了 2 條')))));
await page.click('[data-tab="done"]');
check('they are in the Done tab', (await page.textContent('.lp-body')).includes('週末去看展覽'));
// 「不用」：這次開著時不再提醒
await page.evaluate(async () => { const n = await import('/src/notes.js'); n.reopenNoteManual('p_old'); });
await page.click('[data-tab="notes"]');
await page.click('[data-action="overdue-hide"]');
check('"no thanks" hides it', !(await page.$('[data-role="overdue"]')));

const missing = await page.evaluate(async () => (await import('/src/i18n.js')).missingKeys());
check('i18n keys complete', !missing.length, JSON.stringify(missing));
for (const l of results) console.log(l);
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
