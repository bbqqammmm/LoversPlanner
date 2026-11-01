// 🧠 思考程度（v0.13.58，使用者要求：做摘要等工作時限制模型思考，不思考／低／中／高）：
// 每種工作各自選；每組 API 照網址猜參數格式（也可以指定）；服務商不收就拿掉重送、記下來以後不送；
// 酒館主 API 的不能在這裡調（選單變灰）。
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
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|status of 400/.test(m.text())) errors.push('console: ' + m.text()); });
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const bodies = [];
let strict = false;
const reply = (r) => {
  if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
  const body = JSON.parse(r.request().postData() ?? '{}');
  bodies.push({ url: r.request().url(), body });
  // 不認得思考參數的服務商
  if (strict && ('reasoning_effort' in body)) return r.fulfill({ status: 400, contentType: 'application/json', headers: cors, body: '{"error":{"message":"Unrecognized request argument supplied: reasoning_effort"}}' });
  return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ choices: [{ message: { content: '{"summary":"打招呼。","ops":[]}' }, finish_reason: 'stop' }] }) });
};
await page.route('https://api.example.test/v1/**', reply);
await page.route('https://openrouter.ai/api/v1/**', reply);
await page.route('https://api.siliconflow.cn/v1/**', reply);
// DeepSeek 官方：thinking 開關；關掉時不思考（回報的思考 token 是 0）
await page.route('https://api.deepseek.com/**', (r) => {
  if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
  const body = JSON.parse(r.request().postData() ?? '{}');
  bodies.push({ url: r.request().url(), body });
  const think = body.thinking?.type === 'disabled' ? 0 : 900;
  return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({
    choices: [{ message: { content: '{"summary":"打招呼。","ops":[]}', ...(think ? { reasoning_content: '想了很久'.repeat(50) } : {}) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 20 + think, completion_tokens_details: { reasoning_tokens: think } },
  }) });
});
await page.addInitScript(() => {
  window.__chat = Array.from({ length: 12 }, (_, i) => ({ name: i % 2 ? '沈言' : '小雨', is_user: !(i % 2), mes: `第${i}則`, send_date: `d${i}`, extra: {} }));
  window.__presetSettings = { lovers_planner: { settingsVersion: 6, summary: { mode: 'manual' }, ui: { seenVersion: '9.9.9' }, backup: { auto: false },
    source: 'custom', custom: { url: 'https://api.example.test/v1', key: 'k', model: 'm', timeout: 30 } } };
});
await page.goto(URL);
await page.waitForFunction(() => Boolean(globalThis.loversPlannerInterceptor));
const summarize = (i) => page.evaluate(async (i) => { const s = await import('/src/summarize.js'); s.enqueue(i); await s.waitForIdle(); }, i);
const last = () => bodies[bodies.length - 1]?.body ?? {};
const set = (fn) => page.evaluate(fn);

await summarize(1);
check('not chosen: nothing extra sent', !('reasoning_effort' in last()) && !('reasoning' in last()) && !('thinking' in last()), JSON.stringify(last()));
await set(() => { SillyTavern.getContext().extensionSettings.lovers_planner.thinking.l1 = 'off'; });
await summarize(3);
check('no thinking: reasoning_effort none (OpenAI style by default)', last().reasoning_effort === 'none', JSON.stringify(last()));
await set(() => { const s = SillyTavern.getContext().extensionSettings.lovers_planner; s.thinking.l1 = 'low'; s.custom.url = 'https://openrouter.ai/api/v1'; });
await summarize(5);
check('OpenRouter guessed from the URL', last().reasoning?.effort === 'low' && !('reasoning_effort' in last()), JSON.stringify(last()));
await set(() => { const s = SillyTavern.getContext().extensionSettings.lovers_planner; s.thinking.l1 = 'medium'; s.custom.url = 'https://api.siliconflow.cn/v1'; });
await summarize(7);
check('budget style: enable_thinking + budget, output budget raised to fit', last().enable_thinking === true && last().thinking_budget === 4096 && last().max_tokens >= 6096, JSON.stringify(last()));
await set(() => { const s = SillyTavern.getContext().extensionSettings.lovers_planner; s.thinking.l1 = 'off'; s.custom.thinkingFormat = 'switch'; });
await summarize(9);
check('format can be chosen: thinking switch', last().thinking?.type === 'disabled' && !('enable_thinking' in last()), JSON.stringify(last()));

// 服務商不收：拿掉重送、記下來
strict = true;
await set(() => { const s = SillyTavern.getContext().extensionSettings.lovers_planner; s.custom.url = 'https://api.example.test/v1'; s.custom.thinkingFormat = 'auto'; });
const n0 = bodies.length;
await summarize(11);
const st = await page.evaluate(async () => ({ status: (await import('/src/chat.js')).floorStatus(11), rejected: SillyTavern.getContext().extensionSettings.lovers_planner.custom.thinkingRejected }));
check('rejected: sent again without it, summary still made', bodies.length - n0 === 2 && !('reasoning_effort' in last()) && st.status === 'ok', JSON.stringify({ n: bodies.length - n0, st, last: last() }));
check('remembered for this API', st.rejected === 'effort');
await page.evaluate(async () => { const c = await import('/src/chat.js'); c.setEntry(11, null); const s = await import('/src/summarize.js'); s.enqueue(11); await s.waitForIdle(); });
check('not sent again afterwards', !('reasoning_effort' in last()), JSON.stringify(last()));

// DeepSeek 官方：自動用 thinking 開關；調用紀錄看得出有沒有思考
await page.evaluate(async () => {
  const s = SillyTavern.getContext().extensionSettings.lovers_planner;
  s.custom.url = 'https://api.deepseek.com';
  s.custom.thinkingFormat = 'auto';
  delete s.custom.thinkingRejected;
  s.thinking.l1 = 'off';
  const c = await import('/src/chat.js'); c.setEntry(9, null);
  const sm = await import('/src/summarize.js'); sm.enqueue(9); await sm.waitForIdle();
  s.thinking.l1 = '';
  c.setEntry(7, null); sm.enqueue(7); await sm.waitForIdle();
  // 還原給下面的畫面檢查用
  s.thinking.l1 = 'off';
  s.custom.thinkingRejected = 'switch';
});
check('DeepSeek official: thinking switch guessed from the URL', bodies.some((b) => b.url.includes('deepseek.com') && b.body.thinking?.type === 'disabled'), JSON.stringify(bodies.filter((b) => b.url.includes('deepseek')).map((b) => b.body.thinking)));
const recent = await page.evaluate(async () => (await import('/src/usage.js')).recentUsage(2));
check('call log records the level and thinking tokens', recent[1]?.level === 'off' && recent[1]?.think === 0 && recent[0]?.think === 900 && !recent[0]?.level, JSON.stringify(recent.map((r) => [r.level, r.think])));

// 畫面
await page.evaluate(() => { document.getElementById('extensionsMenu').style.display = ''; document.getElementById('lp_wand_entry').click(); });
await page.click('[data-tab="settings"]');
await page.evaluate(() => document.querySelectorAll('details[data-sec]').forEach((d) => { d.open = true; }));
await page.waitForSelector('[data-thinking="l1"]', { state: 'attached' });
check('each task has a thinking select', (await page.$$('[data-thinking]')).length === 6 && (await page.inputValue('[data-thinking="l1"]')) === 'off');
check('rejected note in the API card', (await page.textContent('[data-api-card="custom"]')).includes('這個服務商不收'));
await page.selectOption('[data-route="compress"]', 'main');
check('tasks on the main API cannot set it here', await page.isDisabled('[data-thinking="compress"]'));
await page.selectOption('[data-thinking="diary"]', 'high');
check('choice saved', await page.evaluate(() => SillyTavern.getContext().extensionSettings.lovers_planner.thinking.diary === 'high'));
await page.locator('[data-role="routes"]').screenshot({ path: `${OUT}/thinking.png` });
const row = await page.textContent('[data-role="usage-recent"]');
check('call log shows it', row.includes('不思考・思考 0 token') && row.includes('思考 900 token'), row.replace(/\s+/g, ' ').slice(0, 300));

const missing = await page.evaluate(async () => (await import('/src/i18n.js')).missingKeys());
check('i18n keys complete', !missing.length, JSON.stringify(missing));
for (const l of results) console.log(l);
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
