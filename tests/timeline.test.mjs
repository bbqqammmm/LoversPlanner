// 🧵 好幾個舊聊天合成一條時間線（v0.13.36，日記第三階段）：同一天有兩個聊天時選只用哪一個；
// 已經用別的聊天寫好的日子不會被蓋掉（先問，同意才重寫）；每天記著來自哪個聊天；寫完自動寫大綱；
// 寫日記時也順便記下舊聊天 OOC 裡的偏好。
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [execSync('npm root -g').toString().trim()] }));

const OUT = process.argv[2] ?? '.';
const URL = `http://127.0.0.1:${process.env.PORT ?? 8765}/tests/harness.html`;
const results = [];
const errors = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
// 截圖時大視窗剛好自動重畫（元素被換掉）：等一下再截一次。
async function shot(selector, path) {
  for (let k = 0; k < 3; k++) {
    try { return await page.locator(selector).screenshot({ path }); } catch (e) { if (k === 2) throw e; await page.waitForTimeout(300); }
  }
}

const lp = (date, summary) => ({ lovers_planner: { v: 2, status: 'ok', summary, date, ops: [], at: 1, hash: 'x' } });
const chatFile = (tag, days) => {
  const out = [{ user_name: '小雨', character_name: '沈言', chat_metadata: {} }];
  let k = 0;
  for (const [date, user, summary] of days) {
    out.push({ name: '小雨', is_user: true, mes: user, send_date: `${tag}${k++}` });
    out.push({ name: '沈言', is_user: false, mes: `${summary}（原文）`, send_date: `${tag}${k++}`, extra: lp(date, summary) });
  }
  return out;
};
const FILES = {
  舊聊天A: chatFile('a', [['2025-04-01', '去喝咖啡吧', 'A：在咖啡店約會'], ['2025-04-02', '(OOC: 希望沈言說話溫柔一點) 書店', 'A：一起去書店']]),
  舊聊天B: chatFile('b', [['2025-04-01', '如果我們在雪山', 'B：IF 線，兩人在雪山'], ['2025-04-03', '回家', 'B：回到家']]),
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text()); });
await page.route('**/api/characters/chats', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
  { file_id: '舊聊天B', file_size: '1KB', chat_items: 4, last_mes: '2026-10-02' },
  { file_id: '舊聊天A', file_size: '1KB', chat_items: 4, last_mes: '2026-10-01' },
]) }));
await page.route('**/api/chats/get', (r) => {
  const name = JSON.parse(r.request().postData() ?? '{}').file_name;
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FILES[name] ?? []) });
});
await page.addInitScript(() => {
  window.__chatId = '新聊天';
  window.__chat = Array.from({ length: 4 }, (_, i) => ({ name: i % 2 ? '沈言' : '小雨', is_user: !(i % 2), mes: `第${i}則`, send_date: `c${i}`, extra: {} }));
  window.__presetSettings = { lovers_planner: { settingsVersion: 5, summary: { mode: 'manual' }, ui: { seenVersion: '9.9.9' }, prefs: { auto: true } } };
});
await page.goto(URL);
await page.waitForFunction(() => Boolean(globalThis.loversPlannerInterceptor));
await page.evaluate(() => {
  window.__diaryPrompts = [];
  window.__generateRaw = async ({ prompt }) => {
    if (prompt.includes('每一天的重點')) return JSON.stringify({ summary: '大綱：四月的事。' });
    const date = prompt.match(/故事裡 (\S+) 這一天/)?.[1];
    if (!date) return JSON.stringify({ summary: 'L1', ops: [] });
    window.__diaryPrompts.push(prompt);
    const which = prompt.includes('A：') ? 'A' : 'B';
    return JSON.stringify({ points: ['重大｜事件'], summary: `${which}的${date}`, ...(prompt.includes('溫柔') ? { prefs: ['希望沈言說話溫柔一點'] } : {}) });
  };
  document.getElementById('extensionsMenu').style.display = '';
  document.getElementById('lp_wand_entry').click();
});
const idle = () => page.evaluate(async () => { for (let i = 0; i < 400; i++) { if ((await import('/src/diary.js')).diaryPending() === 0 && !(await import('/src/summarize.js')).pendingCount({ tasks: true })) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error('timed out'); });
const days = () => page.evaluate(async () => Object.fromEntries((await import('/src/diary.js')).listDiary().map((d) => [d.date, { text: d.original, chats: d.chats, only: d.only }])));

await page.click('[data-tab="diary"]');
await page.click('[data-action="old-open"]');
await page.click('[data-action="old-pick"][data-id="舊聊天A"]');
await page.click('[data-action="old-pick"][data-id="舊聊天B"]');
await page.click('[data-action="old-read"]');
await page.waitForSelector('[data-role="diary-overlaps"]');
const ov = await page.textContent('[data-role="diary-overlaps"]');
check('overlap day listed with both chats', ov.includes('2025-04-01') && ov.includes('只用 舊聊天A') && ov.includes('只用 舊聊天B') && ov.includes('都用'), ov.replace(/\s+/g, ' '));
await shot('[data-role="diary-overlaps"]', `${OUT}/timeline-overlap.png`);
await page.selectOption('[data-role="old-only"][data-date="2025-04-01"]', '舊聊天B');
await page.click('[data-action="diary-start"]');
await idle();
let d = await days();
const p0401 = (await page.evaluate(() => window.__diaryPrompts.slice())).find((x) => x.includes('故事裡 2025-04-01 這一天')) ?? '';
check('only the chosen chat is used for the overlap day', p0401.includes('B：IF 線') && !p0401.includes('A：在咖啡店'), p0401.slice(-300));
check('days remember their chats', JSON.stringify(d['2025-04-01'].chats) === '["舊聊天B"]' && d['2025-04-01'].only === '舊聊天B'
  && JSON.stringify(d['2025-04-02'].chats) === '["舊聊天A"]' && JSON.stringify(d['2025-04-03'].chats) === '["舊聊天B"]', JSON.stringify(d));
check('timeline in date order across chats', Object.keys(d).join(',') === '2025-04-01,2025-04-02,2025-04-03');
check('diary prompt asks for prefs when on', p0401.includes('"prefs": ["…"]'));
check('OOC preference from an old chat saved', await page.evaluate(async () => (await import('/src/prefs.js')).listPrefs().some((p) => p.text === '希望沈言說話溫柔一點' && p.from === 'diary')));
check('outline written after the batch', await page.evaluate(async () => (await import('/src/diary.js')).diaryOutline()?.text === '大綱：四月的事。'));
await page.click('[data-action="diary-toggle"][data-date="2025-04-01"]');
check('day shows where it came from', (await page.textContent('[data-role="diary-from"]')).includes('來自：舊聊天B'));

// 只讀 A 再寫一次：04-01 是 B 寫的，不能被蓋掉
await page.evaluate(() => { window.__diaryPrompts.length = 0; });
await page.click('[data-action="old-pick"][data-id="舊聊天B"]');
await page.click('[data-action="old-read"]');
await page.waitForFunction(() => !document.querySelector('[data-role="diary-overlaps"]') && document.querySelector('[data-role="diary-start"]'));
check('day list says it was written from another chat', (await page.textContent('[data-role="old-days"]')).includes('已用別的聊天寫過'));
await page.click('[data-action="diary-start"]');
await idle();
d = await days();
check('day written from another chat is not overwritten', d['2025-04-01'].text === 'B的2025-04-01' && !(await page.evaluate(() => window.__diaryPrompts.length)), JSON.stringify(d['2025-04-01']));
const cf = await page.textContent('[data-role="diary-conflicts"]');
check('user is told and asked', cf.includes('有 1 天已經有用別的聊天寫的日記（2025-04-01）') && cf.includes('照這次讀的重寫'), cf.replace(/\s+/g, ' '));
await shot('[data-role="diary-conflicts"]', `${OUT}/timeline-conflict.png`);
// 單天的「重寫」也要先問
await page.click('[data-action="diary-conflicts-ok"]');
await page.click('[data-action="diary-rewrite"][data-date="2025-04-01"]');
check('single-day rewrite asks first too', Boolean(await page.$('[data-role="diary-conflicts"]')) && !(await page.evaluate(() => window.__diaryPrompts.length)));
await page.click('[data-action="diary-replace"]');
await idle();
d = await days();
check('rewrite after agreeing uses this read', d['2025-04-01'].text === 'A的2025-04-01' && JSON.stringify(d['2025-04-01'].chats) === '["舊聊天A"]' && !d['2025-04-01'].only, JSON.stringify(d['2025-04-01']));
check('outline marked out of date', await page.evaluate(async () => (await import('/src/diary.js')).diaryOutline()?.stale === true));
await page.waitForFunction(() => document.querySelector('[data-role="diary-outline"]')?.textContent.includes('大綱可能舊了'), null, { timeout: 5000 }).catch(() => {});
check('outline card says so', (await page.textContent('[data-role="diary-outline"]')).includes('大綱可能舊了'));

const missing = await page.evaluate(async () => (await import('/src/i18n.js')).missingKeys());
check('i18n keys complete', !missing.length, JSON.stringify(missing));
for (const l of results) console.log(l);
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
