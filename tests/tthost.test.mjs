// 🦀 TauriTavern 的聊天 API（v0.13.55）：帶日記時只讀那個聊天的聊天資料，不讀整個聊天檔；
// TT 給的格式不對或出錯時，改讀整個檔（酒館的 /api/chats/get）。
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [execSync('npm root -g').toString().trim()] }));

const URL = `http://127.0.0.1:${process.env.PORT ?? 8765}/tests/harness.html`;
const results = [];
const errors = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

const part = (summary) => ({ part: 1, total: 1, floors: 3, summary, points: [], at: 1, by: 'x', style: 'natural' });
const diary = (text) => ({ days: { '2025-03-01': { date: '2025-03-01', parts: [part(text)], use: 'original' } } });

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text()); });
const reads = [];
await page.route('**/api/chats/get', (r) => {
  reads.push(JSON.parse(r.request().postData()).file_name);
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ chat_metadata: { lovers_planner: { diary: diary('從整個聊天檔讀到的。') } } }]) });
});
await page.addInitScript((d) => {
  window.__chatId = '窗口8';
  window.__chat = [{ name: '沈言', is_user: false, mes: '歡迎', send_date: 'b0', extra: {} }];
  window.__presetSettings = { lovers_planner: { settingsVersion: 5, summary: { mode: 'manual' }, ui: { seenVersion: '9.9.9' }, backup: { auto: false } } };
  window.__opened = [];
  window.__ttMode = 'ok';
  // 假的 TT：只有 api.chat 這一塊
  window.__TAURITAVERN__ = {
    ready: Promise.resolve(),
    api: { chat: {
      current: { ref: () => ({ kind: 'character', characterId: 'c1', fileName: '窗口8.jsonl' }) },
      open: (ref) => {
        window.__opened.push(ref);
        return { summary: async ({ includeMetadata }) => (window.__ttMode === 'ok' && includeMetadata ? { metadata: { lovers_planner: { diary: d } } } : { messageCount: 3 }) };
      },
    } },
  };
}, diary('從 TT 只讀聊天資料拿到的。'));
await page.goto(URL);
await page.waitForFunction(() => Boolean(globalThis.loversPlannerInterceptor));

const a = await page.evaluate(async () => {
  const r = await (await import('/src/carry.js')).carryDiaryFrom('窗口7');
  const text = (await import('/src/diary.js')).listDiary()[0]?.original;
  return { added: r.added, text, opened: window.__opened };
});
check('TT: reads only the chat metadata', a.added.length === 1 && a.text === '從 TT 只讀聊天資料拿到的。' && !reads.length, JSON.stringify({ a, reads }));
check('TT: opens the other chat of the same character', a.opened[0]?.characterId === 'c1' && a.opened[0]?.fileName === '窗口7.jsonl' && a.opened[0]?.kind === 'character', JSON.stringify(a.opened));

const b = await page.evaluate(async () => {
  window.__ttMode = 'no-meta';
  (await import('/src/diary.js')).deleteDay('2025-03-01');
  const r = await (await import('/src/carry.js')).carryDiaryFrom('窗口6');
  return { added: r.added, text: (await import('/src/diary.js')).listDiary()[0]?.original };
});
check('falls back to the whole chat file when TT gives no metadata', b.added.length === 1 && b.text === '從整個聊天檔讀到的。' && reads.includes('窗口6'), JSON.stringify({ b, reads }));

for (const l of results) console.log(l);
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
