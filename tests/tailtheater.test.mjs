// 🥚 文末附的彩蛋小劇場（v0.13.49，使用者回報：正文後面附一段「💭 某某的內心小劇場」，整層被當成小劇場，正文沒寫進日記）：
// 摘要和日記只拿掉文末那段（一行短標題到結尾）；對話裡提到小劇場、開頭就是番外的不動；
// 以前被整層標成 ⭐ 小劇場的：舊聊天整理照寫正文（可以關掉），現在的聊天在「重新檢查」裡建議改回照常摘要。
// v0.13.50：只是提到番外（OOC 聊番外）的也算正文；舊聊天整理逐層列出 ⭐ 的樓層，可以勾選。
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [execSync('npm root -g').toString().trim()] }));

const OUT = process.argv[2] ?? '.';
const URL = `http://127.0.0.1:${process.env.PORT ?? 8765}/tests/harness.html`;
const results = [];
const errors = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

const BODY = '沈言把傘收好，替小雨拍掉肩上的雨。兩個人在便利店門口站了一會兒，等雨小一點再走。'.repeat(6);
const TAIL = '<div style="color:#999">💭 沈言的內心小劇場</div>\n<div>（其實他早就想牽她的手了。）</div>';
const WITH_TAIL = `${BODY}\n${TAIL}`;
const ALL_SIDE = `番外：如果他們是同學\n${BODY}`;
const TALK = `${BODY}\n「去看小劇場吧」\n${BODY}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text()); });
await page.addInitScript(({ withTail, allSide }) => {
  window.__chatId = '雨天的約定';
  window.__chat = Array.from({ length: 6 }, (_, i) => ({ name: i % 2 ? '沈言' : '小雨', is_user: !(i % 2), mes: i === 1 ? withTail : i === 3 ? allSide : `第${i}則`, send_date: `d${i}`, extra: {} }));
  window.__presetSettings = { lovers_planner: { settingsVersion: 5, summary: { mode: 'manual' }, ui: { seenVersion: '9.9.9' } } };
}, { withTail: WITH_TAIL, allSide: ALL_SIDE });
await page.goto(URL);
await page.waitForFunction(() => Boolean(globalThis.loversPlannerInterceptor));

// 1. 拿掉文末的小劇場
const f = await page.evaluate(async ({ withTail, allSide, talk }) => {
  const x = await import('/src/filter.js');
  const s = SillyTavern.getContext().extensionSettings.lovers_planner;
  const clean = x.cleanForSummary(withTail);
  const out = { clean, theater: x.extractTheater(withTail), allSide: x.cleanForSummary(allSide), talk: x.cleanForSummary(talk) };
  s.filter.tailTheater = false;
  out.off = x.cleanForSummary(withTail);
  s.filter.tailTheater = true;
  s.filter.theater = 'story';
  out.story = x.cleanForSummary(withTail);
  s.filter.theater = 'keepsake';
  return out;
}, { withTail: WITH_TAIL, allSide: ALL_SIDE, talk: TALK });
check('story kept, the side scene at the end removed', f.clean.includes('便利店') && !f.clean.includes('內心小劇場') && !f.clean.includes('牽她的手'), f.clean.slice(-60));
check('the removed side scene goes to keepsakes', f.theater.includes('內心小劇場') && f.theater.includes('牽她的手') && !f.theater.includes('便利店'), f.theater);
check('a floor that starts as a side scene is not cut', f.allSide.startsWith('番外：如果他們是同學') && f.allSide.length > 200);
check('a line of dialogue is not a heading', f.talk.includes('「去看小劇場吧」') && f.talk.length > BODY.length * 2);
check('can be turned off; "as story" keeps it too', f.off.includes('牽她的手') && f.story.includes('牽她的手'));

// 2. 補建時的番外提醒：文末的小劇場不會讓整層被列出來
const flagged = await page.evaluate(async () => (await import('/src/catchup.js')).findExtras(0, 5).map((x) => x.index));
check('extras prompt: only the real side scene is listed', JSON.stringify(flagged) === '[3]', JSON.stringify(flagged));

// 3. 舊聊天整理：以前整層標成 ⭐ 小劇場的
const old = await page.evaluate(async ({ withTail, allSide }) => {
  const o = await import('/src/oldchats.js');
  const msg = (ai, mes, k) => ({ name: ai ? '沈言' : '小雨', is_user: !ai, mes, send_date: `o${k}`, extra: ai ? { lovers_planner: { status: 'side', summary: '小劇場', date: '2025-06-01' } } : {} });
  const data = [{ chat_metadata: {} }, msg(false, '早', 0), msg(true, withTail, 1), msg(false, '然後', 2), msg(true, allSide, 3)];
  const on = o.analyzeChats([{ id: 'x', data }]);
  const text = o.dayParts('2025-06-01')[0]?.units.filter((u) => u.ai).map((u) => u.text).join('|') ?? '';
  const off = o.analyzeChats([{ id: 'x', data }], { sideBody: false });
  return { on: { ai: on.days[0]?.ai, side: on.days[0]?.side, n: on.totals.sideBody }, off: { ai: off.days[0]?.ai, side: off.days[0]?.side }, text };
}, { withTail: WITH_TAIL, allSide: ALL_SIDE });
check('old chats: the story of such a floor goes into the diary', old.on.ai === 1 && old.on.side === 1 && old.on.n === 1 && old.text.includes('便利店') && !old.text.includes('內心小劇場'), JSON.stringify(old));
check('old chats: can be left out', old.off.ai === 0 && old.off.side === 2, JSON.stringify(old.off));

// 3b. 只是提到番外（v0.13.50，使用者回報：整整幾天都沒寫進日記）：OOC 聊番外的那層是正文；要求寫的番外才是番外
const v = await page.evaluate(async (body) => {
  const x = await import('/src/filter.js');
  return {
    ooc: x.sideStoryVerdict('（OOC：剛剛的番外好好笑，下次再玩小劇場？）「走吧。」', body),
    ask: x.sideStoryVerdict('請生成一個番外小劇場：兩個人變成同學。', body),
    title: x.sideStoryVerdict('', `# 【番外】雨夜\n${body}`),
    sentence: x.sideStoryVerdict('', `番外要開始的時候，我其實很緊張——\n${body}`),
    inner: x.sideStoryVerdict('', `${body.slice(0, 60)}\n💭 沈言的內心小劇場\n${body}`),
  };
}, BODY);
check('verdict: mentions are story, requests and titles are extras', !v.ooc && v.ask && v.title && !v.sentence && !v.inner, JSON.stringify(v));
const DAYS = [{ chat_metadata: {} }];
const side = (k, user, ai, date) => {
  DAYS.push({ name: '小雨', is_user: true, mes: user, send_date: `s${k}u`, extra: {} });
  DAYS.push({ name: '沈言', is_user: false, mes: ai, send_date: `s${k}`, extra: { lovers_planner: { status: 'side', summary: '小劇場', date } } });
};
side(1, '（OOC：剛剛的番外好好笑）好啦，我們回家吧。', BODY, '2025-07-01');
side(2, '請生成一個番外小劇場：兩個人變成同學。', `# 番外：同學\n${BODY}`, '2025-07-01');
side(3, '（OOC：番外好可愛）晚安。', `${BODY}\n睡前。`, '2025-07-02');
const sides = await page.evaluate(async (data) => {
  const o = await import('/src/oldchats.js');
  const r = o.analyzeChats([{ id: 'y', data }]);
  const flip = o.analyzeChats([{ id: 'y', data }], { sideChoice: { 'y#3': true, 'y#5': false } });
  return { list: r.sides.map((x) => `${x.floor}:${x.why}:${x.on}`), days: r.days.map((d) => `${d.date}:${d.ai}`), flip: flip.days.map((d) => `${d.date}:${d.ai}`) };
}, DAYS);
check('old chats: mentions written, the requested extra not', JSON.stringify(sides.list) === '["1:mention:true","3::false","5:mention:true"]' && JSON.stringify(sides.days) === '["2025-07-01:1","2025-07-02:1"]', JSON.stringify(sides));
check('old chats: each floor can be changed', JSON.stringify(sides.flip) === '["2025-07-01:2","2025-07-02:0"]', JSON.stringify(sides.flip));

// 畫面：逐層的清單
await page.route('**/api/characters/chats', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ file_id: '舊的', file_size: '1KB', chat_items: 6, last_mes: '2026-10-02' }]) }));
await page.route('**/api/chats/get', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DAYS) }));
await page.evaluate(() => { document.getElementById('extensionsMenu').style.display = ''; document.getElementById('lp_wand_entry').click(); });
await page.click('[data-tab="diary"]');
await page.click('[data-action="old-open"]');
await page.click('[data-action="old-pick"][data-id="舊的"]');
await page.click('[data-action="old-read"]');
await page.waitForSelector('[data-role="old-sides"]');
await page.click('[data-action="old-sides-toggle"]');
let sideTxt = await page.textContent('[data-role="old-sides"]');
check('UI: side-scene floors listed with suggestions', sideTxt.includes('⭐ 小劇場的樓層（3 層，2 層寫進日記）') && sideTxt.includes('只是提到番外') && (await page.isChecked('[data-key="舊的#1"]')) && !(await page.isChecked('[data-key="舊的#3"]')), sideTxt.replace(/\s+/g, ' ').slice(0, 200));
await page.locator('[data-role="old-sides"]').screenshot({ path: `${OUT}/old-sides.png` });
await page.uncheck('[data-key="舊的#5"]');
sideTxt = await page.textContent('[data-role="old-sides"]');
check('UI: unticking leaves that day out', sideTxt.includes('1 層寫進日記') && (await page.textContent('[data-action="diary-start"]')).includes('1 天'), sideTxt.replace(/\s+/g, ' ').slice(0, 120));
await page.click('[data-action="old-sides"][data-set="all"]');
check('UI: tick all', (await page.textContent('[data-role="old-sides"]')).includes('3 層寫進日記'));
await page.click('[data-action="close"]');

// 4. 現在的聊天：重新檢查會列出來，建議改回照常摘要
await page.evaluate(async () => {
  const { setEntry, floorSource } = await import('/src/chat.js');
  for (const i of [1, 3]) setEntry(i, { v: 2, status: 'side', summary: '小劇場', ops: [], keepsakes: [], hash: floorSource(i).hash, at: 1, prev: null });
});
await page.evaluate(() => { document.getElementById('extensionsMenu').style.display = ''; document.getElementById('lp_wand_entry').click(); });
await page.click('[data-tab="settings"]');
check('setting shown', (await page.textContent('#lp-panel, body')).includes('正文後面用一行短標題接著的小劇場'));
await page.click('details[data-sec="data"] > summary');
await page.click('[data-action="data-rescan"]');
await page.waitForSelector('[data-role="extras"]');
const card = await page.textContent('[data-role="extras"]');
const pick = await page.$eval('[data-extra="1"] [data-role="extra-choice"]', (el) => el.value).catch(() => '');
check('rescan lists the floor, suggests summarizing it as usual', card.includes('現在整層是小劇場，但前面有正文') && pick === 'keep' && !(await page.$('[data-extra="3"]')), JSON.stringify({ pick, card: card.replace(/\s+/g, ' ').slice(0, 200) }));
await page.locator('[data-role="extras"]').screenshot({ path: `${OUT}/tailtheater.png` });
await page.click('[data-action="extras-apply"]');
const after = await page.evaluate(async () => {
  const chat = await import('/src/chat.js');
  const sum = await import('/src/summarize.js');
  return { s1: chat.floorStatus(1), s3: chat.floorStatus(3), queued: sum.pendingCount?.() ?? -1, again: (await import('/src/catchup.js')).findExtrasAll().map((x) => x.index) };
});
check('switched back and queued for summary; not asked again', after.s3 === 'side' && (after.s1 === 'ok' || after.queued >= 1) && !after.again.includes(1), JSON.stringify(after));

const missing = await page.evaluate(async () => (await import('/src/i18n.js')).missingKeys());
check('i18n keys complete', !missing.length, JSON.stringify(missing));
for (const l of results) console.log(l);
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
