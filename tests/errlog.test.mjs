// 🐞 錯誤報告（v0.13.46，使用者要求）：出錯時一鍵複製錯誤報告；只有技術資訊，不含提示詞、模型寫的內容、聊天內容、網址、Key。
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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|status of 500/.test(m.text())) errors.push('console: ' + m.text()); });
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
await page.route('https://broken.test/v1/**', (r) => (r.request().method() === 'OPTIONS'
  ? r.fulfill({ status: 204, headers: cors })
  : r.fulfill({ status: 500, contentType: 'application/json', headers: cors, body: '{"error":{"message":"upstream overloaded, see https://status.example.com/x?token=abc key-ABCDEFGHIJKLMNOPQRS"}}' })));
await page.addInitScript(() => {
  window.__chat = Array.from({ length: 6 }, (_, i) => ({ name: i % 2 ? '沈言' : '小雨', is_user: !(i % 2), mes: `秘密的第${i}則劇情`, send_date: `d${i}`, extra: {} }));
  window.__toasts = [];
  window.toastr = { success: (m) => window.__toasts.push(m), info: (m) => window.__toasts.push(m), warning: (m) => window.__toasts.push(m), error: (m) => { window.__toasts.push(m); return null; } };
  window.__presetSettings = { lovers_planner: { settingsVersion: 5, summary: { mode: 'manual' }, ui: { seenVersion: '9.9.9' }, source: 'custom', custom: { url: 'https://broken.test/v1', key: 'sk-secretsecretsecret', model: 'test-model', timeout: 30 } } };
});
await page.goto(URL);
await page.waitForFunction(() => Boolean(globalThis.loversPlannerInterceptor));
// 1. 服務商出錯（HTTP 500）
await page.evaluate(async () => { const s = await import('/src/summarize.js'); s.enqueue(1); await s.waitForIdle(); });
// 2. 模型回了看不懂的東西（內容不能進報告）
await page.evaluate(async () => {
  const st = SillyTavern.getContext().extensionSettings.lovers_planner;
  st.source = 'main';
  window.__generateRaw = async () => '{"ops": [{"op": "add", "data": {"name": "這是模型寫的私密劇情內容，不應該出現在報告裡"';
  const s = await import('/src/summarize.js'); s.enqueue(3); await s.waitForIdle();
});
const report = await page.evaluate(async () => (await import('/src/errlog.js')).buildReport());
check('report lists both errors with codes', report.includes(' l1 http HTTP 500') && report.includes(' l1 parse'), report);
check('model name and version included', report.includes('test-model') && /version \d+\.\d+\.\d+/.test(report));
check('no prompt, reply or chat content', !report.includes('秘密') && !report.includes('私密劇情') && !report.includes('小雨') && !report.includes('沈言'), report);
check('no URL or key', !report.includes('broken.test') && !report.includes('status.example.com') && !report.includes('sk-secret') && !report.includes('ABCDEFGHIJ') && report.includes('<url>'), report);
check('parse error notes the reply length', /parse \(reply=\d+, cut=yes/.test(report), report);
// 失敗通知有「複製錯誤報告」
check('failure toast offers to copy the report', await page.evaluate(() => window.__toasts.some((x) => String(x).includes('複製錯誤報告'))));
// 設定頁
await page.evaluate(() => { document.getElementById('extensionsMenu').style.display = ''; document.getElementById('lp_wand_entry').click(); });
await page.click('[data-tab="settings"]');
await page.click('details[data-sec="errors"] > summary');
const list = await page.textContent('[data-role="error-list"]');
check('settings lists recent errors', list.includes('單層摘要') && list.includes('服務商回錯誤') && list.includes('格式不對'), list.replace(/\s+/g, ' '));
await page.click('details[data-sec="errors"] [data-action="copy-report"]');
await page.waitForFunction(() => window.__toasts.some((x) => String(x).includes('複製好了')), null, { timeout: 5000 });
const clip = await page.evaluate(() => navigator.clipboard.readText());
check('copied to the clipboard', clip.startsWith("Lover's Planner error report") && clip.includes('parse'), clip.slice(0, 120));
await page.locator('details[data-sec="errors"]').screenshot({ path: `${OUT}/errlog.png` });
// 不能複製時：顯示文字讓使用者自己選
await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('no')) } }); document.execCommand = () => false; });
await page.click('details[data-sec="errors"] [data-action="copy-report"]');
await page.waitForSelector('[data-role="report-text"]');
check('fallback shows the text to select', (await page.inputValue('[data-role="report-text"]')).startsWith("Lover's Planner error report"));
// 不跟著設定導出
check('errors not exported with settings', await page.evaluate(async () => !('errors' in (await import('/src/backup.js')).buildBackup({ settings: true }).settings)));
await page.click('[data-action="clear-errors"]');
check('clear', (await page.textContent('[data-role="error-list"]')).includes('最近沒有錯誤'));

const missing = await page.evaluate(async () => (await import('/src/i18n.js')).missingKeys());
check('i18n keys complete', !missing.length, JSON.stringify(missing));
for (const l of results) console.log(l);
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
