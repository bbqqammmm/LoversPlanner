// 🥚 文末附的彩蛋小劇場（v0.13.49，使用者回報：正文後面附一段「💭 某某的內心小劇場」，整層被當成小劇場，正文沒寫進日記）：
// 摘要和日記只拿掉文末那段（一行短標題到結尾）；對話裡提到小劇場、開頭就是番外的不動；
// 以前被整層標成 ⭐ 小劇場的：舊聊天整理照寫正文（可以關掉），現在的聊天在「重新檢查」裡建議改回照常摘要。
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
