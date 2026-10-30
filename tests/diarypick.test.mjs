// 📖 寫日記只選幾天＋進度（v0.13.43，使用者要求）：每一天可以勾、全選、全不選、選一段日期；
// 預估和「開始寫日記」只算勾起來的；寫的時候顯示正在寫哪天第幾段、這批寫好幾段（進度條）。
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [execSync('npm root -g').toString().trim()] }));

const OUT = process.argv[2] ?? '.';
const URL = `http://127.0.0.1:${process.env.PORT ?? 8765}/tests/harness.html`;
const results = [];
const errors = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

const lp = (date, summary) => ({ lovers_planner: { v: 2, status: 'ok', summary, date, ops: [], at: 1, hash: 'x' } });
const OLD = [{ user_name: '小雨', character_name: '沈言', chat_metadata: {} }];
let k = 0;
const add = (ai, text, extra = {}) => OLD.push({ name: ai ? '沈言' : '小雨', is_user: !ai, mes: text, send_date: `s${k++}`, extra });
add(false, '早'); add(true, '一', lp('2025-03-01', '三月一日'));
add(false, '午'); add(true, '二', lp('2025-03-02', '三月二日'));
for (let i = 0; i < 20; i++) { add(false, `第${i}句`); add(true, `長${i}`, lp('2025-03-03', `長日${i}`)); }

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text()); });
await page.route('**/api/characters/chats', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ file_id: '舊聊天', file_size: '1MB', chat_items: OLD.length - 1, last_mes: '2026-10-01' }]) }));
await page.route('**/api/chats/get', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OLD) }));
await page.addInitScript(() => {
  window.__chatId = '新聊天';
  window.__chat = Array.from({ length: 4 }, (_, i) => ({ name: i % 2 ? '沈言' : '小雨', is_user: !(i % 2), mes: `第${i}則`, send_date: `c${i}`, extra: {} }));
  window.__presetSettings = { lovers_planner: { settingsVersion: 5, summary: { mode: 'manual' }, ui: { seenVersion: '9.9.9' }, diary: { outline: false } } };
});
await page.goto(URL);
await page.waitForFunction(() => Boolean(globalThis.loversPlannerInterceptor));
await page.evaluate(() => {
  window.__release = null;
  window.__generateRaw = async ({ prompt }) => {
    const date = prompt.match(/故事裡 (\S+) 這一天/)?.[1];
    if (!date) return '{"summary":"x","ops":[]}';
    // 每一段等測試放行才寫完，才看得到進度。
    await new Promise((r) => { window.__release = r; });
    return JSON.stringify({ points: ['重大｜事'], summary: `日記${date}` });
  };
  document.getElementById('extensionsMenu').style.display = '';
  document.getElementById('lp_wand_entry').click();
});
await page.click('[data-tab="diary"]');
await page.click('[data-action="old-open"]');
await page.click('[data-action="old-pick"]');
await page.click('[data-action="old-read"]');
await page.waitForSelector('[data-role="diary-start"]');
const startText = () => page.textContent('[data-action="diary-start"]');
check('all days picked by default', (await startText()).includes('3 天'));
await page.click('[data-role="old-days"] > summary');
await page.click('[data-action="old-days-none"]');
check('none picked: start disabled', await page.$eval('[data-action="diary-start"]', (b) => b.disabled) && (await page.textContent('[data-role="old-day-pick"]')).includes('勾了 0／3 天'));
await page.selectOption('[data-role="old-from"]', '2025-03-01');
await page.selectOption('[data-role="old-to"]', '2025-03-01');
await page.click('[data-action="old-days-range"]');
check('range picks one day', (await startText()).includes('1 天') && (await page.textContent('[data-role="diary-start"]')).includes('共 1 次'));
await page.click('[data-action="old-day"][data-date="2025-03-03"]');
check('tap adds a day; estimate follows', (await startText()).includes('2 天') && (await page.textContent('[data-role="diary-start"]')).includes('共 3 次'), (await page.textContent('[data-role="diary-start"]')).replace(/\s+/g, ' ').slice(0, 120));
check('list stays open after picking', await page.$eval('[data-role="old-days"]', (d) => d.open));
await page.locator('[data-role="old-day-pick"]').screenshot({ path: `${OUT}/diarypick.png` });
await page.click('[data-action="diary-start"]');
// 第一段：03-01
await page.waitForFunction(() => document.querySelector('[data-role="diary-progress"]')?.textContent.includes('正在寫 2025-03-01'), null, { timeout: 5000 });
check('progress shows the day being written', (await page.textContent('[data-role="diary-progress"]')).includes('這一批寫好 0／3 段'));
await page.evaluate(() => window.__release());
await page.waitForFunction(() => document.querySelector('[data-role="diary-progress"]')?.textContent.includes('第 1／2 段'), null, { timeout: 5000 });
const pg = await page.textContent('[data-role="diary-progress"]');
check('long day shows which part, count moves on', pg.includes('正在寫 2025-03-03（第 1／2 段）') && pg.includes('這一批寫好 1／3 段'), pg.replace(/\s+/g, ' '));
check('progress bar', await page.$eval('[data-role="diary-progress"] progress', (p) => p.max === 3 && p.value === 1));
await page.locator('[data-role="diary-progress"]').screenshot({ path: `${OUT}/diaryprogress.png` });
await page.evaluate(() => window.__release());
await page.waitForFunction(() => document.querySelector('[data-role="diary-progress"]')?.textContent.includes('第 2／2 段'), null, { timeout: 5000 });
await page.evaluate(() => window.__release());
await page.waitForFunction(() => !document.querySelector('[data-role="diary-progress"]'), null, { timeout: 5000 });
const days = await page.evaluate(async () => (await import('/src/diary.js')).listDiary().map((d) => d.date));
check('only the picked days written', JSON.stringify(days) === '["2025-03-01","2025-03-03"]', JSON.stringify(days));

// v0.13.47：每一天標日記寫好了沒；全選時已寫好的不算進預估；只選還沒寫的
await page.waitForFunction(() => document.querySelector('[data-action="old-day"][data-date="2025-03-01"]')?.textContent.includes('已寫日記'), null, { timeout: 5000 });
check('written days marked in the list', (await page.textContent('[data-action="old-day"][data-date="2025-03-03"]')).includes('✅ 已寫日記') && !(await page.textContent('[data-action="old-day"][data-date="2025-03-02"]')).includes('已寫'));
await page.click('[data-action="old-days-all"]');
check('all picked: written days left out of the estimate', (await startText()).includes('1 天') && (await page.textContent('[data-role="diary-skip-done"]')).includes('有 2 天已經寫好了'), (await page.textContent('[data-role="diary-start"]')).replace(/\s+/g, ' ').slice(0, 160));
await page.click('[data-action="old-days-none"]');
await page.click('[data-action="old-days-unwritten"]');
check('only unwritten picks the rest', (await page.textContent('[data-role="old-day-pick"]')).includes('勾了 1／3 天') && (await page.$eval('[data-action="old-day"][data-date="2025-03-02"]', (b) => b.getAttribute('aria-pressed'))) === 'true');
await page.locator('[data-role="old-days"]').screenshot({ path: `${OUT}/diarypick-state.png` });

const missing = await page.evaluate(async () => (await import('/src/i18n.js')).missingKeys());
check('i18n keys complete', !missing.length, JSON.stringify(missing));
for (const l of results) console.log(l);
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
