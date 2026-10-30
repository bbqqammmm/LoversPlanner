// 🎃 召回看使用者最新的話（v0.13.51，使用者回報：寫了「萬聖節」，萬聖節的事完全沒有召回）：
// 少見的詞（萬聖節）有出現就召回、節日和日期對到那天、常見的詞不算、人名照舊算名字；
// 向量另外拿使用者最新的話單獨比；回執寫出為什麼（同樣的詞「萬聖節」、同一天 10-31）。
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [execSync('npm root -g').toString().trim()] }));

const OUT = process.argv[2] ?? '.';
const URL = `http://127.0.0.1:${process.env.PORT ?? 8765}/tests/harness.html`;
const results = [];
const errors = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

// 21 個 AI 樓層（0,2,…,40），最後一句是使用者（41）。AI 的回覆很長，蓋過使用者短短的一句。
const CHAT = [];
for (let i = 0; i < 42; i++) {
  const ai = i % 2 === 0;
  CHAT.push({ name: ai ? '沈言' : '小雨', is_user: !ai, mes: ai ? `AI${i}` : `U${i}`, send_date: `d${i}`, extra: {} });
}
CHAT[40].mes = '沈言把咖啡放在桌上，窗外在下雨。'.repeat(60);
CHAT[41].mes = '今年萬聖節我們要扮什麼？';

// 假的向量模型：只看「萬聖」和「咖啡」兩個維度。
function fakeEmbed(text) {
  return [0.01, (text.split('萬聖').length - 1), (text.split('咖啡').length - 1)];
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text()); });
const embedded = [];
await page.route('https://embed.test/v1/embeddings', async (route) => {
  const body = JSON.parse(route.request().postData());
  embedded.push(...body.input);
  const data = body.input.map((x, index) => ({ index, embedding: fakeEmbed(x) }));
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ data }) });
});
await page.addInitScript((chat) => {
  window.__chat = chat;
  window.__presetSettings = { lovers_planner: { settingsVersion: 5, summary: { mode: 'manual' }, ui: { seenVersion: '9.9.9' }, compress: { auto: true, l1PerL2: 3, l2PerL3: 50, ratioMin: 30, ratioMax: 40 }, recall: { memoryTopK: 3 }, diary: { recallTopK: 2, recentDays: 1 } } };
}, CHAT);
await page.goto(URL);
await page.waitForFunction(() => document.getElementById('lp_wand_entry') && globalThis.loversPlannerInterceptor);

await page.evaluate(async () => {
  const { floorSource, setEntry } = await import('/src/chat.js');
  const days = { 2: ['2024-10-31', '小雨扮成小南瓜，兩人去萬聖節派對，沈言被嚇了一跳。'], 4: ['2024-10-31', '派對結束後兩人去吃宵夜。'], 6: ['2024-12-25', '兩人在海城過聖誕節，交換了圍巾。'] };
  for (let i = 0; i < 40; i += 2) {
    const [date, summary] = days[i] ?? [`2024-11-${String(1 + i).padStart(2, '0')}`, `我們今天一起吃飯，聊了很多（第${i}層）。`];
    setEntry(i, { v: 2, status: 'ok', time: '', location: '家', characters: [], summary, date, ops: [], hash: floorSource(i).hash, at: 1000 + i });
  }
  window.__chat[0].extra.lovers_planner.ops = [
    { op: 'add', id: 'c_lin', type: 'character', data: { name: '林曉', relation: '朋友' } },
    { op: 'add', id: 'p_ghost', type: 'promise', data: { content: '萬聖節一起去鬼屋' } },
    { op: 'add', id: 'p_tea', type: 'promise', data: { content: '我們今天一起去喝茶' } },
  ];
  (await import('/src/notes.js')).invalidateNotes();
  const part = (summary) => ({ part: 1, total: 1, floors: 3, summary, points: [], time: '', location: '', at: 1, by: 'x', style: 'natural' });
  window.__chatMetadata.lovers_planner = {
    ...(window.__chatMetadata.lovers_planner ?? {}),
    diary: {
      sources: ['舊聊天'],
      days: {
        '2023-10-31': { date: '2023-10-31', parts: [part('第一次一起過萬聖節，在海城的老街走了很久。')], compressed: null, use: 'original', chats: ['舊聊天'] },
        '2023-11-02': { date: '2023-11-02', parts: [part('我們今天一起吃飯。')], compressed: null, use: 'original', chats: ['舊聊天'] },
        '2023-11-03': { date: '2023-11-03', parts: [part('我們今天一起散步。')], compressed: null, use: 'original', chats: ['舊聊天'] },
        '2024-11-20': { date: '2024-11-20', parts: [part('最近的一天。')], compressed: null, use: 'original', chats: ['舊聊天'] },
      },
    },
  };
  window.__generateRaw = async ({ prompt }) => (prompt.includes('章節總結') ? '章' : '{"summary":"x","ops":[]}');
  await window.__emit('chat_id_changed');
});
const run = () => page.evaluate(() => window.__runInterceptor('normal'));
const select = () => page.evaluate(async () => {
  const { computeHidden } = await import('/src/hide.js');
  const r = await (await import('/src/recall.js')).selectRelevant({ keepFrom: computeHidden().keepFrom });
  return {
    notes: Object.fromEntries([...r.notes].map(([id, x]) => [id, `${x.reason}${x.term ? `:${x.term}` : ''}`])),
    memories: r.memories.map((m) => `${m.index}:${m.reason}:${m.term ?? ''}`),
    diary: r.diary.map((d) => `${d.date}:${d.reason}:${d.term ?? ''}`),
    vector: r.vector,
  };
});

// ===== 1. 只有關鍵字（沒設定向量） =====
await run();
let sel = await select();
check('memory with the word recalled', sel.memories.includes('2:word:萬聖節'), JSON.stringify(sel.memories));
check('memory on the same day recalled', sel.memories.includes('4:date:10-31'), JSON.stringify(sel.memories));
check('Christmas and common words not recalled', !sel.memories.some((m) => m.startsWith('6:')) && sel.memories.length === 2, JSON.stringify(sel.memories));
check('old diary with the word recalled; common words do not count', JSON.stringify(sel.diary) === '["2023-10-31:word:萬聖節"]', JSON.stringify(sel.diary));
check('promise with the word sent; one with only common words not', sel.notes.p_ghost === 'word:萬聖節' && !sel.notes.p_tea, JSON.stringify(sel.notes));
const inj = (await run()).injection.value;
check('injected', inj.includes('萬聖節派對') && inj.includes('第一次一起過萬聖節') && inj.includes('萬聖節一起去鬼屋'), inj.slice(0, 500));

// 日期的寫法
const days = await page.evaluate(async () => {
  const { focusDays } = await import('/src/recall.js');
  return ['萬聖節快到了', '平安夜和聖誕節', '10月31日那天', '還記得 12/24 嗎', '白色情人節', '情人節', '2024/10/31'].map((x) => [...focusDays(x)].join(','));
});
check('holidays and dates', JSON.stringify(days) === '["10-31","12-24,12-25","10-31","12-24","03-14","02-14",""]', JSON.stringify(days));

// ===== 2. 向量：使用者最新的話另外比一次 =====
await page.evaluate(() => {
  const s = SillyTavern.getContext().extensionSettings.lovers_planner;
  s.recall.vector = { enabled: true, url: 'https://embed.test/v1', key: 'k', model: 'fake' };
  s.recall.threshold = 60;
});
sel = await select();
check('the latest message is embedded on its own', embedded.some((x) => x.trim() === '今年萬聖節我們要扮什麼？'.toLowerCase()), JSON.stringify(embedded.slice(0, 3)).slice(0, 200));
check('vectors on: still recalled', sel.vector === 'ok' && sel.memories.includes('2:word:萬聖節'), JSON.stringify(sel));

// ===== 3. 回執寫出為什麼 =====
await run();
const receipt = await page.evaluate(async () => {
  window.__chat.push({ name: '沈言', is_user: false, mes: '回覆', send_date: 'd42', extra: {} });
  await window.__emit('message_received', 42);
  return (await import('/src/ui/message.js')).sentHtml(42);
});
check('receipt says why: same word / same day', receipt.includes('同樣的詞「萬聖節」') && receipt.includes('同一天（10-31）'), receipt.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 400));

const missing = await page.evaluate(async () => (await import('/src/i18n.js')).missingKeys());
check('i18n keys complete', !missing.length, JSON.stringify(missing));
for (const l of results) console.log(l);
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
