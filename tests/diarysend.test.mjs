// 📨 日記送給角色（v0.13.36，日記第三階段）：最近幾天送全文、更早的聊到相關的事才找回、大綱每回都送；
// 送出預覽、這一回送了什麼；💬 你的偏好（OOC 自動記下、刪掉不再加回來、暫停、自己寫、每回提醒）。
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
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text()); });
await page.addInitScript(() => {
  window.__chatId = '新聊天';
  window.__toasts = [];
  window.toastr = { success: (m) => window.__toasts.push(m), info: (m) => window.__toasts.push(m), warning: (m) => window.__toasts.push(m), error: (m) => window.__toasts.push(m) };
  const msgs = ['早安', '早安，今天想做什麼？', '(OOC: 希望沈言更主動一點) 好睏', '那就再睡一下。', '我們再去燈塔看看吧', '好，下午就去。'];
  window.__chat = msgs.map((mes, i) => ({ name: i % 2 ? '沈言' : '小雨', is_user: !(i % 2), mes, send_date: `c${i}`, extra: {} }));
  window.__presetSettings = { lovers_planner: { settingsVersion: 5, summary: { mode: 'manual' }, ui: { seenVersion: '9.9.9' }, memories: { recall: false } } };
});
await page.goto(URL);
await page.waitForFunction(() => Boolean(globalThis.loversPlannerInterceptor));
await page.evaluate(async () => {
  window.__generateRaw = async ({ prompt }) => {
    if (prompt.includes('每一天的重點')) return JSON.stringify({ summary: '一月在海城相遇，五月一起過日子。' });
    if (prompt.includes('prefs')) return JSON.stringify({ summary: '小雨想睡，沈言讓她再睡。', ops: [], prefs: ['希望沈言更主動一點', '繼續'] });
    return JSON.stringify({ summary: 'L1', ops: [] });
  };
  const s = await import('/src/summarize.js');
  // 這個聊天的故事日期：2025-05-10
  s.writeSummary(1, { summary: '早上打招呼。', date: '2025-05-10' });
  s.writeSummary(3, { summary: '再睡一下。', date: '2025-05-10' });
  const part = (summary, extra = {}) => ({ part: 1, total: 1, floors: 3, summary, points: [{ level: 'major', text: summary.slice(0, 6) }], time: '', location: '', at: 1, by: 'x', style: 'natural', ...extra });
  window.__chatMetadata.lovers_planner = {
    ...(window.__chatMetadata.lovers_planner ?? {}),
    diary: {
      sources: ['舊聊天'],
      days: {
        '2025-01-05': { date: '2025-01-05', parts: [part('兩人第一次在燈塔下說話，交換了電話。', { location: '海城・燈塔' })], compressed: null, use: 'original', chats: ['舊聊天'] },
        '2025-02-14': { date: '2025-02-14', parts: [part('情人節，小雨送了手作巧克力。', { total: 2 }), part('晚上一起看電影。', { part: 2, total: 2 })], compressed: null, use: 'original', chats: ['舊聊天'] },
        '2025-03-01': { date: '2025-03-01', parts: [part('原版：搬家的一天，很長很長。')], compressed: { summary: '壓縮版：搬進新家。', at: 1, by: 'x', ratio: 0.5, keep: [], from: 10 }, use: 'compressed', chats: ['舊聊天'] },
        '2025-05-08': { date: '2025-05-08', parts: [part('一起去超市買了菜。')], compressed: null, use: 'original', chats: ['舊聊天'] },
        '2025-05-09': { date: '2025-05-09', parts: [part('下雨天在家做蛋糕。')], compressed: null, use: 'original', chats: ['舊聊天'] },
      },
    },
  };
});
const inject = () => page.evaluate(async () => (await window.__runInterceptor('normal')).injection?.value ?? '');

// ===== 最近幾天送全文、更早的找回、大綱 =====
let text = await inject();
check('recent days sent in full', text.includes('【以前的日記】') && text.includes('最近幾天：') && text.includes('【2025-05-08】一起去超市買了菜。') && text.includes('【2025-05-09】下雨天在家做蛋糕。'), text.slice(0, 600));
check('older day recalled by place keyword', text.includes('和現在有關的那幾天：') && text.includes('【2025-01-05】兩人第一次在燈塔下說話'), text.slice(0, 600));
check('unrelated older days not sent', !text.includes('巧克力') && !text.includes('搬進新家') && !text.includes('看電影'));
check('diary goes before the story summaries', text.indexOf('【以前的日記】') < text.indexOf('【前情摘要】') || !text.includes('【前情摘要】'));
const plan = await page.evaluate(async () => (await import('/src/diarysend.js')).diaryPlan());
check('plan: anchor from this chat, compressed day is one unit, long day split', plan.anchor === '2025-05-10' && plan.from === '2025-05-08'
  && plan.older.some((u) => u.key === '2025-03-01#c' && u.line.includes('壓縮版')) && plan.older.filter((u) => u.date === '2025-02-14').length === 2
  && plan.older.some((u) => u.line.startsWith('【2025-02-14 2/2】')), JSON.stringify(plan).slice(0, 400));

// 大綱：寫好後每回都送
await page.evaluate(async () => { const d = await import('/src/diary.js'); d.queueOutline(); });
await page.evaluate(async () => { for (let i = 0; i < 200; i++) { if (Boolean((await import('/src/diary.js')).diaryOutline())) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error('timed out'); });
const outlinePrompt = await page.evaluate(() => window.__prompts.map((p) => p.prompt).find((p) => p.includes('每一天的重點')) ?? '');
check('outline prompt lists each day with its key points', outlinePrompt.includes('2025-01-05：兩人第一次在') && outlinePrompt.includes('2025-05-09：下雨天在家做'), outlinePrompt.slice(-300));
text = await inject();
check('outline sent', text.includes('大綱：\n一月在海城相遇，五月一起過日子。'), text.slice(0, 300));
check('outline goes stale when a day changes', await page.evaluate(async () => { const d = await import('/src/diary.js'); d.editDay('2025-05-09', '下雨天在家做蛋糕，還烤焦了。'); return d.diaryOutline().stale; }));

// 送出預覽、這一回送了什麼
const prev = await page.evaluate(async () => { const p = await (await import('/src/hide.js')).previewInjection(); return { recalled: p.parts.diary.recalled.length, recent: p.parts.diary.recent.length, tokens: p.tokens.diary }; });
check('preview counts the diary', prev.recalled === 1 && prev.recent === 2 && prev.tokens > 0, JSON.stringify(prev));
await page.evaluate(() => { document.getElementById('extensionsMenu').style.display = ''; document.getElementById('lp_wand_entry').click(); });
await page.click('details[data-role="preview"] > summary').catch(() => {});
await page.waitForFunction(() => document.querySelector('[data-role="preview-body"]')?.textContent.includes('以前的日記'), null, { timeout: 5000 }).catch(() => {});
check('preview row shows the diary', (await page.textContent('[data-role="preview-body"]').catch(() => '')).includes('以前的日記：最近 2 天＋找回 1 段＋大綱'));
const receipt = await page.evaluate(async () => {
  const chat = window.__chat;
  chat[5].extra.lovers_planner_sent = { v: 1, at: Date.now(), type: 'normal', filtered: true, notesTotal: 0, notesSent: 0, notes: [], floors: [], reminders: [], vector: 'off', error: '', fetched: 0, injectedTokens: 10, hiddenTokens: 0,
    diary: [{ date: '2025-01-05', part: 1, total: 1, line: '【2025-01-05】兩人第一次在燈塔下說話', reason: 'keyword' }] };
  return (await import('/src/ui/message.js')).sentHtml(5);
});
check('receipt lists recalled diary parts', receipt.includes('📖 找回的日記（1 段）') && receipt.includes('燈塔') && receipt.includes('日記 1 段'), receipt.slice(0, 300));

// 日記區塊：送給角色的設定和說明
await page.click('[data-tab="summary"]');
await page.waitForSelector('[data-role="diary-send"]');
let info = await page.textContent('[data-role="diary-send-info"]');
check('diary card explains what is sent', info.includes('2025-05-10') && info.includes('2025-05-08～2025-05-09') && info.includes('最多找回 2 段'), info);
await page.fill('input[data-path="diary.recentDays"]', '1');
await page.dispatchEvent('input[data-path="diary.recentDays"]', 'change');
info = await page.textContent('[data-role="diary-send-info"]');
check('changing the number updates the explanation', info.includes('沒有在最近幾天裡的日記'), info);
text = await inject();
check('recent days 1: May days now only by recall', !text.includes('最近幾天：') && !text.includes('超市'), text.slice(0, 400));
await page.locator('[data-role="diary-send"]').screenshot({ path: `${OUT}/diarysend.png` });
await page.locator('[data-role="diary-outline"]').screenshot({ path: `${OUT}/outline.png` });
await page.click('input[data-path="diary.send"]');
text = await inject();
check('turning sending off removes the diary', !text.includes('【以前的日記】'));
await page.click('input[data-path="diary.send"]');

// ===== 💬 你的偏好 =====
const promptOff = await page.evaluate(async () => (await (await import('/src/summarize.js')).buildL1Prompt(3)).prompt);
check('no prefs rule while off', !promptOff.includes('prefs'));
await page.evaluate(() => { SillyTavern.getContext().extensionSettings.lovers_planner.prefs.auto = true; });
const promptOn = await page.evaluate(async () => (await (await import('/src/summarize.js')).buildL1Prompt(3)).prompt);
check('prefs rule and format while on', promptOn.includes('prefs：小雨 在 OOC') && promptOn.includes('"prefs": ["…"]'));
await page.evaluate(async () => { window.__toasts = []; const s = await import('/src/summarize.js'); s.enqueue(3); await s.waitForIdle(); });
let prefs = await page.evaluate(async () => (await import('/src/prefs.js')).listPrefs().map((p) => `${p.text}|${p.from}`));
check('OOC preference saved, too-short one-off dropped', prefs.length === 1 && prefs[0] === '希望沈言更主動一點|ooc', JSON.stringify(prefs));
check('toast when saved', await page.evaluate(() => (window.__toasts ?? []).some((x) => String(x).includes('記下了你的偏好：希望沈言更主動一點'))), JSON.stringify(await page.evaluate(() => window.__toasts)));
check('stored on the character, not the chat', await page.evaluate(() => (SillyTavern.getContext().extensionSettings.lovers_planner.characters['shenyan.png']?.prefs ?? []).length >= 1));
text = await inject();
check('preferences sent every turn, first', text.includes('【小雨 劇情外的要求（請一直遵守）】\n- 希望沈言更主動一點\n\n') && text.indexOf('劇情外的要求') < text.indexOf('【以前的日記】'), text.slice(0, 300));
// 刪掉的不會再被加回來；同一句的不同寫法也算重複
await page.evaluate(async () => {
  const p = await import('/src/prefs.js');
  for (const x of p.listPrefs()) p.removePref(x.id);
  const s = await import('/src/summarize.js'); s.enqueue(3); await s.waitForIdle();
});
prefs = await page.evaluate(async () => (await import('/src/prefs.js')).listPrefs().map((p) => p.text));
check('deleted preference does not come back', !prefs.length, JSON.stringify(prefs));
const dup = await page.evaluate(async () => { const p = await import('/src/prefs.js'); const a = p.addPref('別一直重複我的話'); const b = p.addPref('別一直重複我的話！'); return [Boolean(a), Boolean(b)]; });
check('duplicates ignored', dup[0] && !dup[1], JSON.stringify(dup));
// 畫面：設定 › 你的偏好
await page.click('[data-tab="settings"]');
await page.click('details[data-sec="prefs"] > summary');
await page.fill('[data-role="pref-new"]', '早上要叫我起床');
await page.click('[data-action="pref-add"]');
let list = await page.textContent('[data-role="prefs"]');
check('add from the settings page', list.includes('早上要叫我起床') && list.includes('自己寫的') && list.includes('別一直重複我的話'), list.replace(/\s+/g, ' '));
await page.click('[data-pref] [data-action="pref-toggle"]');
text = await inject();
check('paused preference not sent', !text.includes('別一直重複我的話') && text.includes('早上要叫我起床'), text.slice(0, 200));
await page.click('[data-pref]:nth-child(2) [data-action="pref-edit"]');
await page.fill('[data-role="pref-edit"]', '早上七點叫我起床');
await page.click('[data-action="pref-save"]');
list = await page.textContent('[data-role="prefs"]');
check('edit a preference', list.includes('早上七點叫我起床') && list.includes('暫停中'), list.replace(/\s+/g, ' '));
await page.locator('details[data-sec="prefs"]').screenshot({ path: `${OUT}/prefs.png` });
await page.click('input[data-path="prefs.inject"]');
text = await inject();
check('turning reminders off stops sending', !text.includes('劇情外的要求'));

const missing = await page.evaluate(async () => (await import('/src/i18n.js')).missingKeys());
check('i18n keys complete', !missing.length, JSON.stringify(missing));
const tpl = await page.evaluate(async () => { const p = await import('/src/prompts.js'); return ['zh-TW', 'zh-CN', 'en'].every((l) => p.defaultTemplate('diaryOutline', l)?.includes('{{days}}')); });
check('outline template in all three languages', tpl);
for (const l of results) console.log(l);
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
