// 🔀 換聊天、換角色（v0.13.42，使用者回報：打開別的角色的聊天，舊聊天整理列的還是上一個角色的聊天）：
// 舊聊天清單、讀到的內容、選好的導入檔都要清掉，不能拿上一個角色的舊聊天寫進這個聊天的日記。
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
const file = (tag) => [{ user_name: '小雨', character_name: tag, chat_metadata: {} },
  { name: '小雨', is_user: true, mes: '早', send_date: `${tag}0` },
  { name: tag, is_user: false, mes: `${tag}的原文`, send_date: `${tag}1`, extra: lp('2025-06-01', `${tag}的摘要`) }];
const CHATS = { 'shenyan.png': ['沈言的舊聊天'], 'guyan.png': ['顧言的舊聊天'] };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text()); });
await page.route('**/api/characters/chats', (r) => {
  const { avatar_url } = JSON.parse(r.request().postData());
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((CHATS[avatar_url] ?? []).map((id) => ({ file_id: id, file_size: '1KB', chat_items: 2, last_mes: '2026-10-01' }))) });
});
await page.route('**/api/chats/get', (r) => {
  const { file_name } = JSON.parse(r.request().postData());
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(file(file_name.slice(0, 2))) });
});
await page.addInitScript(() => {
  window.__chatId = '沈言的新聊天';
  window.__characters = [{ name: '沈言', avatar: 'shenyan.png' }];
  window.__chat = Array.from({ length: 4 }, (_, i) => ({ name: i % 2 ? '沈言' : '小雨', is_user: !(i % 2), mes: `第${i}則`, send_date: `c${i}`, extra: {} }));
  window.__presetSettings = { lovers_planner: { settingsVersion: 5, summary: { mode: 'manual' }, ui: { seenVersion: '9.9.9' } } };
});
await page.goto(URL);
await page.waitForFunction(() => Boolean(globalThis.loversPlannerInterceptor));
await page.evaluate(() => { document.getElementById('extensionsMenu').style.display = ''; document.getElementById('lp_wand_entry').click(); });
await page.click('[data-action="old-open"]');
await page.click('[data-action="old-pick"]');
await page.click('[data-action="old-read"]');
await page.waitForSelector('[data-role="diary-start"]');
check('first character: its own old chats', (await page.textContent('[data-role="oldchats"]')).includes('沈言的舊聊天'));

// 換成另一個角色的聊天（大視窗開著）
await page.evaluate(async () => {
  window.__characters = [{ name: '顧言', avatar: 'guyan.png' }];
  window.__chatId = '顧言的新聊天';
  window.__chat.length = 0;
  for (let i = 0; i < 4; i++) window.__chat.push({ name: i % 2 ? '顧言' : '小雨', is_user: !(i % 2), mes: `顧${i}`, send_date: `g${i}`, extra: {} });
  await window.__emit('chat_id_changed');
});
await page.waitForSelector('[data-action="old-open"]');
check('old-chat card closed and cleared', !(await page.$('[data-role="diary-start"]')) && !(await page.evaluate(async () => (await import('/src/oldchats.js')).hasLoadedDays())));
await page.click('[data-action="old-open"]');
await page.waitForSelector('[data-action="old-pick"]');
const list = await page.textContent('[data-role="oldchats"]');
check('second character: lists its own old chats', list.includes('顧言的舊聊天') && !list.includes('沈言的舊聊天'), list.replace(/\s+/g, ' '));
check('no diary can be written from the other character', (await page.evaluate(async () => (await import('/src/diary.js')).queueDays(['2025-06-01']))) === 0);

const missing = await page.evaluate(async () => (await import('/src/i18n.js')).missingKeys());
check('i18n keys complete', !missing.length, JSON.stringify(missing));
for (const l of results) console.log(l);
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
