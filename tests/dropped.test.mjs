// 連線半路斷了（v0.13.62，使用者回報 iOS 的「TypeError: Load failed」）：
// 已經收到回應、讀內容時才斷，要變成看得懂的「dropped」、自動再試一次、成功就標「已自動重試成功」，
// 不改走酒館轉發、不重複記兩筆；一直斷的話試兩次就停，訊息看得懂。
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [execSync('npm root -g').toString().trim()] }));

const URL = `http://127.0.0.1:${process.env.PORT ?? 8765}/tests/harness.html`;
const results = [];
const errors = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.addInitScript(() => {
  window.__presetSettings = { lovers_planner: { settingsVersion: 5, source: 'custom', custom: { url: 'https://drop.example/v1', key: 'k', model: 'm-flash' }, summary: { mode: 'manual' }, recall: { notes: false, memory: false }, compress: { auto: false } } };
  // 前 window.__drops 次：回應到了，讀內容時斷線（WebKit 給 TypeError: Load failed）。
  const real = window.fetch.bind(window);
  window.__direct = 0;
  window.__backend = 0;
  window.fetch = async (url, opt) => {
    const u = String(url);
    if (u.includes('/api/backends/chat-completions/')) window.__backend++;
    if (!u.startsWith('https://drop.example/')) return real(url, opt);
    window.__direct++;
    if (window.__direct <= window.__drops) return { ok: true, status: 200, text: async () => { throw new TypeError('Load failed'); } };
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '接好了' } }] }) };
  };
});
await page.goto(URL);
await page.waitForFunction(() => Boolean(document.getElementById('lp_wand_entry') && globalThis.loversPlannerInterceptor), null, { timeout: 15000 });

// ===== 1. 斷一次：再試成功 =====
const once = await page.evaluate(async () => {
  window.__drops = 1; window.__direct = 0; window.__backend = 0;
  const { generateText } = await import('/src/llm.js');
  const { listErrors, clearErrors } = await import('/src/errlog.js');
  clearErrors();
  const t0 = Date.now();
  const text = await generateText('hi', { purpose: 'l1', maxTokens: 100 });
  return { text, ms: Date.now() - t0, direct: window.__direct, backend: window.__backend, errors: listErrors() };
});
check('retried after a drop and got the reply', once.text === '接好了' && once.direct === 2, JSON.stringify(once));
check('waited a little before retrying', once.ms >= 1800, String(once.ms));
check('did not switch to the tavern backend', once.backend === 0);
check('logged once as dropped, marked recovered', once.errors.length === 1 && once.errors[0].code === 'dropped' && once.errors[0].recovered === 1 && once.errors[0].where === 'l1', JSON.stringify(once.errors));

// ===== 2. 一直斷：試兩次就停，錯誤看得懂 =====
const always = await page.evaluate(async () => {
  window.__drops = 99; window.__direct = 0; window.__backend = 0;
  const { generateText } = await import('/src/llm.js');
  const { listErrors, clearErrors, noteError } = await import('/src/errlog.js');
  const { errorText } = await import('/src/errors.js');
  clearErrors();
  let err;
  try { await generateText('hi', { purpose: 'l1', maxTokens: 100 }); } catch (e) { err = e; }
  // 功能那一層也會叫 noteError：不能再多記一筆。
  noteError('l1', err);
  return { code: err?.code, text: errorText(err), direct: window.__direct, backend: window.__backend, errors: listErrors().map((e) => [e.code, e.recovered ?? 0]) };
});
check('gives up after two tries', always.code === 'dropped' && always.direct === 2 && always.backend === 0, JSON.stringify(always));
check('readable message', always.text.includes('斷') && !always.text.includes('Load failed'), always.text);
check('no duplicate entry from the feature layer', always.errors.length === 2 && always.errors.every(([c, r]) => c === 'dropped' && r === 0), JSON.stringify(always.errors));

// ===== 3. 錯誤報告和調用紀錄看得懂 =====
const report = await page.evaluate(async () => {
  const { buildReport } = await import('/src/errlog.js');
  const { t } = await import('/src/i18n.js');
  return { report: buildReport(), usage: t('usage.err.dropped') };
});
check('report lists dropped', report.report.includes('l1 dropped'), report.report.split('\n').slice(0, 6).join(' | '));
check('usage label', report.usage === '連線中斷', report.usage);

// ===== 4. App 在背景時先不重試，回到前景才試 =====
const hidden = await page.evaluate(async () => {
  window.__drops = 1; window.__direct = 0;
  let hide = true;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hide });
  const { generateText } = await import('/src/llm.js');
  const p = generateText('hi', { purpose: 'l1', maxTokens: 100 });
  await new Promise((r) => setTimeout(r, 3500));
  const whileHidden = window.__direct;
  hide = false;
  document.dispatchEvent(new Event('visibilitychange'));
  const text = await p;
  delete document.hidden;
  return { whileHidden, after: window.__direct, text };
});
check('waits for the app to come back before retrying', hidden.whileHidden === 1 && hidden.after === 2 && hidden.text === '接好了', JSON.stringify(hidden));

console.log(results.join('\n'));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
