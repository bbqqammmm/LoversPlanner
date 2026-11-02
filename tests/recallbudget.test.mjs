// 🧺 找回改成總字數上限＋同一天合併＋TT 原文搜尋（v0.13.56，使用者問：只有日記裡有的事搜得到嗎？相關的不只 3～5 段怎麼辦？）
// 1. 相關的很多時：照分數放到字數上限為止，0＝不限（只受段數上限）。
// 2. 同一天找回了日記，那天的單層回憶不再送。日記段落的 total（那天有幾段）不會被分數蓋掉。
// 3. TT：搜現在的聊天（摘要沒寫到、原文有的）和寫過日記的舊聊天（對到那天的日記；對不到的送一小段原文）；
//    搜到的那層沒有使用者的話裡的詞就不算。
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [execSync('npm root -g').toString().trim()] }));

const URL = `http://127.0.0.1:${process.env.PORT ?? 8765}/tests/harness.html`;
const results = [];
const errors = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

const CHAT = [];
for (let i = 0; i < 42; i++) {
  const ai = i % 2 === 0;
  CHAT.push({ name: ai ? '沈言' : '小雨', is_user: !ai, mes: ai ? `AI${i}` : `U${i}`, send_date: `d${i}`, extra: {} });
}
CHAT[30].mes = '他們在海城的燈塔下面放了一盞孔明燈。';
CHAT[41].mes = '還記得那盞孔明燈嗎？今年萬聖節要扮什麼？';

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text()); });
// 這個角色現在有的聊天（日記記著的「不見了的聊天」不在這裡）
await page.route('**/api/characters/chats', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ file_id: '雨天的約定' }, { file_id: '舊聊天' }, { file_id: '會壞掉的聊天' }]) }));
await page.addInitScript((chat) => {
  window.__chat = chat;
  window.__presetSettings = { lovers_planner: { settingsVersion: 5, summary: { mode: 'manual' }, ui: { seenVersion: '9.9.9' }, backup: { auto: false },
    compress: { auto: true, l1PerL2: 3, l2PerL3: 50, ratioMin: 30, ratioMax: 40 }, recall: { memoryTopK: 3 }, diary: { recallTopK: 2, recentDays: 1 } } };
}, CHAT);
await page.goto(URL);
await page.waitForFunction(() => document.getElementById('lp_wand_entry') && globalThis.loversPlannerInterceptor);
const migrated = await page.evaluate(() => { const s = SillyTavern.getContext().extensionSettings.lovers_planner; return [s.recall.memoryTopK, s.diary.recallTopK, s.recall.budget]; });
check('old defaults raised (3 → 8, 2 → 5), budget added', JSON.stringify(migrated) === '[8,5,1500]', JSON.stringify(migrated));

const long = '兩人在夜市逛了很久，買了糖葫蘆和烤魷魚，還在套圈圈的攤位前面站了好一會兒，最後抱著一隻小熊回家。'.repeat(2);
await page.evaluate(async (long) => {
  const { floorSource, setEntry } = await import('/src/chat.js');
  for (let i = 0; i < 40; i += 2) {
    // 0～22 層都是 10-31（萬聖節那天），很長；其他是別的日子
    const date = i <= 22 ? '2024-10-31' : `2024-11-${String(i).padStart(2, '0')}`;
    setEntry(i, { v: 2, status: 'ok', time: '', location: '家', characters: [], summary: i <= 22 ? `第${i}層：${long}` : `第${i}層的日常。`, date, ops: [], hash: floorSource(i).hash, at: 1000 + i });
  }
  const part = (summary, extra = {}) => ({ part: 1, total: 1, floors: 3, summary, points: [], time: '', location: '', at: 1, by: 'x', style: 'natural', ...extra });
  window.__chatMetadata.lovers_planner = {
    ...(window.__chatMetadata.lovers_planner ?? {}),
    diary: { sources: ['舊聊天'], days: {
      '2023-10-31': { date: '2023-10-31', parts: [part('去年萬聖節的日記，第一段。', { total: 2 }), part('去年萬聖節的日記，第二段。', { part: 2, total: 2 })], use: 'original', chats: ['舊聊天'], ranges: [{ chat: '舊聊天', from: 0, to: 20 }] },
      '2023-06-01': { date: '2023-06-01', parts: [part('普通的一天。')], use: 'original', chats: ['舊聊天'], ranges: [{ chat: '舊聊天', from: 21, to: 40 }] },
      '2024-11-30': { date: '2024-11-30', parts: [part('最近的一天。')], use: 'original', chats: ['舊聊天'] },
      '2022-01-01': { date: '2022-01-01', parts: [part('很久以前。')], use: 'original', chats: ['不見了的聊天', '會壞掉的聊天'] },
    } },
  };
  window.__generateRaw = async ({ prompt }) => (prompt.includes('章節總結') ? '章' : '{"summary":"x","ops":[]}');
  await window.__emit('chat_id_changed');
}, long);
await page.evaluate(() => window.__runInterceptor('normal'));
const select = () => page.evaluate(async () => {
  const { computeHidden } = await import('/src/hide.js');
  const r = await (await import('/src/recall.js')).selectRelevant({ keepFrom: computeHidden().keepFrom });
  return { memories: r.memories.map((m) => `${m.index}:${m.reason}:${m.term ?? ''}`), diary: r.diary.map((d) => `${d.date}#${d.part}/${d.total}:${d.reason}:${d.term ?? ''}${d.raw ? ':raw' : ''}`), lines: r.diary.map((d) => d.line), tokens: r.tokens };
});
const set = (patch) => page.evaluate((patch) => { const s = SillyTavern.getContext().extensionSettings.lovers_planner; for (const [k, v] of Object.entries(patch)) { const [a, b] = k.split('.'); s[a][b] = v; } }, patch);

// ===== 1. 字數上限 =====
await set({ 'recall.budget': 0, 'diary.recallTopK': 0 });
let sel = await select();
check('no budget: up to the count limit', sel.memories.length === 8, JSON.stringify(sel));
await set({ 'recall.budget': 300 });
sel = await select();
check('budget: stops when full', sel.memories.length >= 1 && sel.memories.length <= 3 && sel.tokens <= 300, JSON.stringify(sel));

// ===== 2. 同一天合併、段落的 total =====
await set({ 'recall.budget': 0, 'diary.recallTopK': 5 });
sel = await select();
check('diary of the same day replaces that day\'s memories', sel.diary.some((d) => d.startsWith('2023-10-31')) && sel.memories.length === 8, JSON.stringify(sel));
check('diary parts keep their total', sel.diary.some((d) => d.startsWith('2023-10-31#1/2:word:') && d.includes('萬聖節')) && sel.diary.some((d) => d.startsWith('2023-10-31#2/2:word:')), JSON.stringify(sel.diary));

// ===== 3. TT 原文搜尋 =====
await page.evaluate(() => {
  const hit = (index, role, text, score = 0.8) => ({ index, role, text, snippet: text.slice(0, 60), score });
  window.__searches = [];
  window.__TAURITAVERN__ = { ready: Promise.resolve(), api: { chat: {
    current: {
      ref: () => ({ kind: 'character', characterId: 'c1', fileName: '雨天的約定.jsonl' }),
      handle: () => ({ searchMessages: async ({ query }) => { window.__searches.push(['current', query]); return [hit(30, 'assistant', window.__chat[30].mes), hit(31, 'user', '嗯嗯好的你說了算')]; } }),
    },
    open: (ref) => ({ searchMessages: async ({ query }) => {
      window.__searches.push([ref.fileName, query]);
      if (ref.fileName.startsWith('會壞掉的聊天')) throw new Error('Not found: Chat not found');
      return [hit(25, 'assistant', '那天晚上在河邊放了孔明燈，許了願。'), hit(80, 'assistant', '<div>我們一起把孔明燈點起來，風很大。</div>'), hit(81, 'user', '好啊好啊我也是')];
    } }),
  } } };
});
await set({ 'recall.budget': 0, 'recall.memoryTopK': 30 });
sel = await select();
const searches = await page.evaluate(() => window.__searches);
check('searched this chat and the chats the diary came from', searches.some((x) => x[0] === 'current') && searches.some((x) => x[0] === '舊聊天.jsonl'), JSON.stringify(searches));
check('chats that no longer exist are not searched', !searches.some((x) => x[0].startsWith('不見了的聊天')), JSON.stringify(searches));
await select();
const again = await page.evaluate(() => window.__searches.filter((x) => x[0].startsWith('會壞掉的聊天')).length);
check('a chat that failed is not searched again', again === 1, String(again));
check('a floor whose summary missed the word is found from the original text', sel.memories.some((m) => m.startsWith('30:word:') && m.includes('孔明燈')), JSON.stringify(sel.memories));
check('a hit in an old chat brings back that day\'s diary', sel.diary.some((d) => d.startsWith('2023-06-01#1/1:word:') && d.includes('孔明燈')), JSON.stringify(sel.diary));
check('a hit with no known day sends a short excerpt', sel.diary.some((d) => d.endsWith(':raw')) && sel.lines.some((l) => l.includes('原文片段') && l.includes('一起把孔明燈點起來') && !l.includes('<div>')), JSON.stringify(sel.lines));
check('hits without the user\'s words are ignored', !sel.lines.some((l) => l.includes('好啊好啊')), JSON.stringify(sel.lines));
const inj = (await page.evaluate(() => window.__runInterceptor('normal'))).injection?.value ?? '';
check('injected', inj.includes('原文片段') && inj.includes('普通的一天'), inj.slice(0, 400));
await set({ 'recall.ttSearch': false });
sel = await select();
check('can be turned off', !sel.diary.some((d) => d.endsWith(':raw')) && !sel.memories.some((m) => m.startsWith('30:word:') && m.includes('孔明燈')), JSON.stringify(sel));

const missing = await page.evaluate(async () => (await import('/src/i18n.js')).missingKeys());
check('i18n keys complete', !missing.length, JSON.stringify(missing));
for (const l of results) console.log(l);
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
