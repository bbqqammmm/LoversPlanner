// 更新通知（v0.13.30，使用者要求）：更新後打開大視窗，最上面有一張「更新了什麼」的卡片，魔術棒選單上有 NEW。
// 按「知道了」記下看過的版本（settings.ui.seenVersion），下次有新版本才再出現。
// 只有 notes 裡寫了東西的版本才算「有消息」；只修小錯、使用者感覺不到的版本不寫，就不會跳通知。
// 用使用者看得懂的話寫，不寫程式術語。新的放最前面。

import { getSettings, saveSettings } from './settings.js';
import { currentLocale } from './i18n.js';
import { VERSION } from './version.js';

export const CHANGES = [
    {
        v: '0.13.47',
        new: {
            'zh-TW': ['📖 舊聊天整理的「每一天」清單會標出哪些日子已經寫好日記（✅）、寫了一部分（⏳）或失敗（⚠️）；多了「只選還沒寫的」，預估也不再算已經寫好的。'],
            'zh-CN': ['📖 旧聊天整理的「每一天」清单会标出哪些日子已经写好日记（✅）、写了一部分（⏳）或失败（⚠️）；多了「只选还没写的」，预估也不再算已经写好的。'],
            en: ['📖 The day list in Old chats now marks days whose diary is written (✅), partly written (⏳) or failed (⚠️); there is an "Only unwritten" button, and the estimate leaves out days already written.'],
        },
    },
    {
        v: '0.13.46',
        new: {
            'zh-TW': ['🐞 錯誤報告：出錯時按「📋 複製錯誤報告」就能貼給 Claude 或作者，不用截圖。只有技術資訊（什麼時候、哪個功能、錯誤碼、模型名稱、回覆多長），不含提示詞、模型寫的內容、聊天內容、網址和 Key。在設定 › 🐞 錯誤報告，摘要失敗的通知、日記失敗的提示上也有。'],
            'zh-CN': ['🐞 错误报告：出错时按「📋 复制错误报告」就能贴给 Claude 或作者，不用截图。只有技术信息（什么时候、哪个功能、错误码、模型名称、回复多长），不含提示词、模型写的内容、聊天内容、网址和 Key。在设置 › 🐞 错误报告，摘要失败的通知、日记失败的提示上也有。'],
            en: ['🐞 Error report: when something fails, press "📋 Copy error report" and paste it to Claude or the author instead of a screenshot. It has only technical details (when, which feature, error code, model, reply length) and never prompts, generated text, chat content, URLs or keys. In Settings › 🐞 Error report, and on summary-failure notices and diary failures.'],
        },
    },
    {
        v: '0.13.45',
        fix: {
            'zh-TW': ['寫日記出現「看不懂模型的回覆」：被截斷、或日記裡用了半形引號的回覆，現在大多救得回來；寫到一半被截斷的會自動加倍額度重寫一次。還是失敗時，錯誤會附上模型回了什麼，像是拒絕寫的也會提示。'],
            'zh-CN': ['写日记出现「看不懂模型的回复」：被截断、或日记里用了半角引号的回复，现在大多救得回来；写到一半被截断的会自动加倍额度重写一次。还是失败时，错误会附上模型回了什么，像是拒绝写的也会提示。'],
            en: ['"Could not read the model\'s reply" when writing diaries: cut-off replies and ones with unescaped quotes are now mostly recovered, and cut-off parts are rewritten once with a doubled budget. If it still fails, the error shows what the model said and hints when it looks like a refusal.'],
        },
    },
    {
        v: '0.13.44',
        new: {
            'zh-TW': [
                '📖 日記有自己的分頁了：📦 舊聊天整理和日記都從摘要分頁搬過去。',
                '🗓️ 舊聊天沒有戀人手帳或 Horae 的日期時，會自動從狀態欄這類標籤（或純文字的「日期：…」）讀故事日期；讀結果裡會寫從哪裡讀的，可以改選別的標籤。',
            ],
            'zh-CN': [
                '📖 日记有自己的分页了：📦 旧聊天整理和日记都从摘要分页搬过去。',
                '🗓️ 旧聊天没有恋人手帐或 Horae 的日期时，会自动从状态栏这类标签（或纯文本的「日期：…」）读故事日期；读结果里会写从哪里读的，可以改选别的标签。',
            ],
            en: [
                '📖 Diaries have their own tab now: Old chats and the diary moved there from the Summaries tab.',
                '🗓️ Old chats without Lover\'s Planner or Horae dates now get their story dates from a status-bar tag (or plain "Date: …" lines) automatically; the result says where they came from, and you can pick another tag.',
            ],
        },
    },
    {
        v: '0.13.43',
        new: {
            'zh-TW': ['📖 寫日記可以只選幾天：「每一天」清單點一下勾選或取消，也可以全選、全不選、選一段日期；寫的時候顯示正在寫哪一天、第幾段，和這一批的進度條。'],
            'zh-CN': ['📖 写日记可以只选几天：「每一天」清单点一下勾选或取消，也可以全选、全不选、选一段日期；写的时候显示正在写哪一天、第几段，和这一批的进度条。'],
            en: ['📖 Write diaries for just some days: tap days in the day list to tick them, or pick all, none or a date range; while writing you see which day and part is being written, with a progress bar for the batch.'],
        },
    },
    {
        v: '0.13.42',
        fix: {
            'zh-TW': ['換到別的角色（或別的聊天）後，📦 舊聊天整理列的還是上一個角色的舊聊天，修好了。讀到一半的內容、選好準備導入的檔案也會一起清掉，不會寫進別的聊天。'],
            'zh-CN': ['换到别的角色（或别的聊天）后，📦 旧聊天整理列的还是上一个角色的旧聊天，修好了。读到一半的内容、选好准备导入的文件也会一起清掉，不会写进别的聊天。'],
            en: ['After switching to another character (or chat), "📦 Old chats" still listed the previous character\'s chats; fixed. Half-read content and a backup file picked for import are cleared too, so nothing lands in the wrong chat.'],
        },
    },
    {
        v: '0.13.41',
        fix: {
            'zh-TW': ['魔術棒選單上的 NEW：打開過一次大視窗就不再顯示，有新版本才會再出現（更新內容的卡片還在，按「知道了」才收起來）。'],
            'zh-CN': ['魔术棒菜单上的 NEW：打开过一次大窗口就不再显示，有新版本才会再出现（更新内容的卡片还在，按「知道了」才收起来）。'],
            en: ['The NEW badge on the wand menu now goes away once you open the panel, and comes back only with a new version (the update card stays until you press "Got it").'],
        },
    },
    {
        v: '0.13.40',
        new: {
            'zh-TW': ['📖 日記有寫失敗的日子時，上方可以按「重寫失敗的」一次重寫全部失敗的。'],
            'zh-CN': ['📖 日记有写失败的日子时，上方可以按「重写失败的」一次重写全部失败的。'],
            en: ['📖 When some diary days fail, a "Retry the failed ones" button rewrites them all at once.'],
        },
        fix: {
            'zh-TW': ['寫日記時出現「empty_length」：以前給模型的輸出額度太少，會先思考的模型想完就沒額度寫了。現在和壓縮一樣至少 4000（只照實際用的計費），錯誤也改成看得懂的說明。'],
            'zh-CN': ['写日记时出现「empty_length」：以前给模型的输出额度太少，会先思考的模型想完就没额度写了。现在和压缩一样至少 4000（只照实际用的计费），错误也改成看得懂的说明。'],
            en: ['"empty_length" when writing diaries: the output budget was too small, so models that think first ran out before writing. It is now at least 4000 like compression (you pay only for what is used), and errors are shown in plain words.'],
        },
    },
    {
        v: '0.13.39',
        new: {
            'zh-TW': ['⏰ 約定／待辦的預定日期過了一個星期以上還沒完成時（常見於從舊聊天帶來的），行事曆／約定分頁上方會提醒，可以一次標成已完成，或先篩出來一條一條看。'],
            'zh-CN': ['⏰ 约定／待办的预定日期过了一个星期以上还没完成时（常见于从旧聊天带来的），行事历／约定分页上方会提醒，可以一次标成已完成，或先筛出来一条一条看。'],
            en: ['⏰ When promises / to-dos are more than a week past their date and still open (common for ones carried over from an old chat), the Calendar & promises tab offers to mark them all done, or to show them first.'],
        },
    },
    {
        v: '0.13.38',
        fix: {
            'zh-TW': [
                '約定的「和誰」是 char 或 user 時，不會再因為提到他們的名字就被送出去（以前幾乎每條約定都算「提到名字」）。',
                '在 v0.13.33 以前帶到新聊天的，行事曆（生理期、親熱、紀念日）沒有跟著過去：行事曆上方會問要不要補帶，按一下就從舊聊天讀過來，不用打開它。',
            ],
            'zh-CN': [
                '约定的「和谁」是 char 或 user 时，不会再因为提到他们的名字就被发送出去（以前几乎每条约定都算「提到名字」）。',
                '在 v0.13.33 以前带到新聊天的，行事历（生理期、亲热、纪念日）没有跟着过去：行事历上方会问要不要补带，按一下就从旧聊天读过来，不用打开它。',
            ],
            en: [
                'Promises made with {{char}} or {{user}} are no longer sent just because their names come up (almost every promise used to count as "name mentioned").',
                'Chats carried over before v0.13.33 did not bring the calendar (periods, intimacy, anniversaries): the calendar now offers to bring it over from the old chat with one tap, without opening it.',
            ],
        },
    },
    {
        v: '0.13.37',
        new: {
            'zh-TW': [
                '🛟 自動備份：每天第一次打開聊天、摘要每多 50 層時，自動把戀人手帳的資料存一份（每個聊天留 7 份），存在酒館的資料夾裡。次數和份數都可以改。在設定 › 資料管理。',
                '🚨 防失憶警報：摘要突然少了一大半時會跳提醒，按一下就能從備份放回去；放回之前會先把現在的樣子再存一份。',
                '📦 一鍵備份全部聊天：這個角色或所有角色的聊天打包成一個檔下載。導入後，現在的聊天馬上放回，其他聊天打開時自動放回。',
            ],
            'zh-CN': [
                '🛟 自动备份：每天第一次打开聊天、摘要每多 50 层时，自动把恋人手帐的数据存一份（每个聊天留 7 份），存在酒馆的文件夹里。次数和份数都可以改。在设置 › 资料管理。',
                '🚨 防失忆警报：摘要突然少了一大半时会跳提醒，按一下就能从备份放回去；放回之前会先把现在的样子再存一份。',
                '📦 一键备份全部聊天：这个角色或所有角色的聊天打包成一个文件下载。导入后，现在的聊天马上放回，其他聊天打开时自动放回。',
            ],
            en: [
                '🛟 Automatic backups: when you first open a chat each day and after every 50 more summarized floors, the Lover\'s Planner data is saved (7 kept per chat) in the tavern\'s data folder. Both numbers can be changed. In Settings › Data.',
                '🚨 Lost-memory alarm: if the summaries suddenly drop by more than half, you are warned and can restore them with one tap; the current state is saved first.',
                '📦 Back up all chats: pack the chats of this character or every character into one file. After importing, the open chat is restored right away and the others when you open them.',
            ],
        },
    },
    {
        v: '0.13.36',
        new: {
            'zh-TW': [
                '📨 日記會送給角色了：最近 3 天（可以改）送全文；更早的平常不送，聊到相關的事才找回那一段；另外有一份很短的大綱每回都送。設定在摘要分頁的「📖 日記」裡。',
                '🧵 好幾個舊聊天一起整理時，同一天有兩個聊天寫到（像 IF 線），可以選只用哪一個；已經用別的聊天寫好的日子不會被蓋掉，會先問你。',
                '💬 你的偏好：OOC 裡對角色的長期要求（例如「希望他更主動」）可以記成一張清單，每回提醒角色。可以自己寫，也可以打開自動記下（預設關）。在設定 › 你的偏好。',
            ],
            'zh-CN': [
                '📨 日记会发送给角色了：最近 3 天（可以改）送全文；更早的平常不送，聊到相关的事才找回那一段；另外有一份很短的大纲每回都送。设置在摘要分页的「📖 日记」里。',
                '🧵 好几个旧聊天一起整理时，同一天有两个聊天写到（像 IF 线），可以选只用哪一个；已经用别的聊天写好的日子不会被盖掉，会先问你。',
                '💬 你的偏好：OOC 里对角色的长期要求（例如「希望他更主动」）可以记成一张清单，每回提醒角色。可以自己写，也可以打开自动记下（默认关）。在设置 › 你的偏好。',
            ],
            en: [
                '📨 Diaries are now sent to the character: the last 3 days (adjustable) in full; older days only when something related comes up; plus a very short outline every turn. Settings are in "📖 Diary" on the Summaries tab.',
                '🧵 When several old chats are read together and a day appears in two of them (like an IF line), you can choose which one to use; days already written from another chat are not overwritten without asking.',
                '💬 Your preferences: lasting OOC requests to the character (e.g. "take more initiative") can be kept as a list the character is reminded of every turn. Write them yourself or turn on picking them up automatically (off by default). In Settings › Your preferences.',
            ],
        },
        fix: {
            'zh-TW': ['舊聊天整理：新的一天開頭那句話以前會算進前一天，現在算進當天。'],
            'zh-CN': ['旧聊天整理：新的一天开头那句话以前会算进前一天，现在算进当天。'],
            en: ['Old chats: the first line of a new day used to be counted in the day before; it now belongs to its own day.'],
        },
    },
    {
        v: '0.13.35',
        new: {
            'zh-TW': ['🔀 可以多存幾組 API，再選每種工作用哪一組（例如單層摘要用便宜的、壓縮和日記再壓一次用細膩的），還能設定「失敗時改用」另一組自動再試一次。在設定 › 模型來源。'],
            'zh-CN': ['🔀 可以多存几组 API，再选每种工作用哪一组（例如单层摘要用便宜的、压缩和日记再压一次用细腻的），还能设定「失败时改用」另一组自动再试一次。在设置 › 模型来源。'],
            en: ['🔀 Save several API groups and choose which job uses which (e.g. a cheap one for floor summaries, a careful one for compression and diary re-compress), plus a fallback group that is retried automatically on failure. In Settings › Model source.'],
        },
    },
    {
        v: '0.13.34',
        new: {
            'zh-TW': [
                '📖 日記：舊聊天整理讀完之後，可以把每一天寫成一篇日記（太長的一天分段寫）。已經有摘要的樓層用摘要，不用重讀原文，省很多。',
                '✍️ 日記寫法可以選「自然」（像回憶，有心情）或「精簡」（像紀錄）；每一天也能單獨換寫法重寫。OOC 不會寫進日記。',
                '🗜️ 再壓一次：先勾要留的重點、選壓到多少，原版一直留著，壓得不好可以換回來；也可以把超過多少字的日子一起壓。',
            ],
            'zh-CN': [
                '📖 日记：旧聊天整理读完之后，可以把每一天写成一篇日记（太长的一天分段写）。已经有摘要的楼层用摘要，不用重读原文，省很多。',
                '✍️ 日记写法可以选「自然」（像回忆，有心情）或「精简」（像记录）；每一天也能单独换写法重写。OOC 不会写进日记。',
                '🗜️ 再压一次：先勾要留的重点、选压到多少，原版一直留着，压得不好可以换回来；也可以把超过多少字的日子一起压。',
            ],
            en: [
                '📖 Diary: after reading old chats, each day can be written as a diary entry (long days in parts). Floors that already have a summary send the summary instead of the original, which saves a lot.',
                '✍️ Choose a natural (like a memory, with feelings) or concise (like a record) style, and rewrite single days in the other style. OOC is never written into the diary.',
                '🗜️ Re-compress: tick the points to keep and pick how short; the original is always kept so you can switch back. Days over a length can be compressed together.',
            ],
        },
    },
    {
        v: '0.13.33',
        new: {
            'zh-TW': ['📦 舊聊天整理（日記的第一步）：摘要分頁可以直接讀同角色的舊聊天（不會打開、不會卡），照故事日期分天、看每天多大，還能把生理期、親熱、紀念日帶進現在的聊天。'],
            'zh-CN': ['📦 旧聊天整理（日记的第一步）：摘要分页可以直接读同角色的旧聊天（不会打开、不会卡），照故事日期分天、看每天多大，还能把生理期、亲热、纪念日带进现在的聊天。'],
            en: ['📦 Old chats (first step toward diaries): the Summary tab can read this character\'s old chats without opening them, group them by story date with sizes, and bring periods, intimacy and anniversaries into this chat.'],
        },
        fix: {
            'zh-TW': ['開同角色的新聊天時，生理期、親熱、紀念日以前不會跟著帶過去，現在會了（跟著摘要一起帶）。'],
            'zh-CN': ['开同角色的新聊天时，生理期、亲热、纪念日以前不会跟着带过去，现在会了（跟着摘要一起带）。'],
            en: ['Periods, intimacy and anniversaries now carry over to new chats with the same character (together with the summary).'],
        },
    },
    {
        v: '0.13.32',
        new: {
            'zh-TW': ['🎂 「行事曆／約定」分頁多了紀念日清單：看得到全部紀念日、生日和還有幾天，可以直接新增、改、刪（不用先點月曆）。'],
            'zh-CN': ['🎂 「行事历／约定」分页多了纪念日清单：看得到全部纪念日、生日和还有几天，可以直接新增、改、删（不用先点月历）。'],
            en: ['🎂 The Calendar tab now lists all anniversaries and birthdays with days left, and you can add, edit or delete them directly.'],
        },
    },
    {
        v: '0.13.31',
        new: {
            'zh-TW': [
                '📖 那年今日：故事裡的今天碰到以前的同一天，會跳出當時的回憶，還可以讓角色想起來。',
                '🎂 紀念日、生日那天打開戀人手帳，會飄一陣花瓣。',
                '🎉 一起寫到 100、500、1000…層時，有個小慶祝。',
                '🤫 還有一個藏起來的小彩蛋，找找看～',
            ],
            'zh-CN': [
                '📖 那年今日：故事里的今天碰到以前的同一天，会跳出当时的回忆，还可以让角色想起来。',
                '🎂 纪念日、生日那天打开恋人手帐，会飘一阵花瓣。',
                '🎉 一起写到 100、500、1000…层时，有个小庆祝。',
                '🤫 还有一个藏起来的小彩蛋，找找看～',
            ],
            en: [
                '📖 On this day: when the story reaches the same date as before, the memory from back then pops up, and you can let the character remember it.',
                '🎂 On anniversaries and birthdays, petals drift down when you open Lover\'s Planner.',
                '🎉 A small celebration at 100, 500, 1000… floors.',
                '🤫 There is also a hidden easter egg. Try to find it~',
            ],
        },
    },
    {
        v: '0.13.30',
        new: {
            'zh-TW': [
                '🔍 每則 AI 回覆下面的摘要區塊可以點開「這一回送了什麼」：送了哪些記事、向量和關鍵字找回哪些舊樓層（相似度多少）、想起哪條回憶，還有向量有沒有正常運作。',
                '🎉 更新之後打開戀人手帳，會看到這張「更新了什麼」的卡片。',
            ],
            'zh-CN': [
                '🔍 每条 AI 回复下面的摘要区块可以点开「这一回发送了什么」：发送了哪些记事、向量和关键词找回哪些旧楼层（相似度多少）、想起哪条回忆，还有向量有没有正常运作。',
                '🎉 更新之后打开恋人手帐，会看到这张「更新了什么」的卡片。',
            ],
            en: [
                '🔍 Each AI reply\'s summary block now has "What was sent this turn": which notes were sent, which older floors vectors and keywords recalled (with similarity), which memory was brought up, and whether vectors worked.',
                '🎉 After an update, opening Lover\'s Planner shows this "What\'s new" card.',
            ],
        },
    },
    {
        v: '0.13.29',
        fix: {
            'zh-TW': ['3000 多則的長聊天打開會卡住好幾分鐘，修好了。'],
            'zh-CN': ['3000 多条的长聊天打开会卡住好几分钟，修好了。'],
            en: ['Opening a chat with 3000+ messages no longer freezes for minutes.'],
        },
    },
    {
        v: '0.13.28',
        fix: {
            'zh-TW': ['長聊天打開、送出、切換大視窗分頁都變快很多。'],
            'zh-CN': ['长聊天打开、发送、切换大窗口分页都变快很多。'],
            en: ['Long chats open, send and switch panel tabs much faster.'],
        },
    },
    {
        v: '0.13.27',
        fix: {
            'zh-TW': ['⭐ 小劇場排隊時換聊天，會變成「標了但沒讀」：現在摘要區塊會說明，🩺 檢查也會列出，可以一鍵補讀。'],
            'zh-CN': ['⭐ 小剧场排队时换聊天，会变成「标了但没读」：现在摘要区块会说明，🩺 检查也会列出，可以一键补读。'],
            en: ['A ⭐ side scene queued while switching chats could end up marked but unread. The block now says so, and 🩺 Checkup lists it with a one-click re-read.'],
        },
    },
    {
        v: '0.13.26',
        new: {
            'zh-TW': ['🌱 草地綠、☁️ 天空藍改成完整的主題（小山丘、幸運草、藍天白雲）。'],
            'zh-CN': ['🌱 草地绿、☁️ 天空蓝改成完整的主题（小山丘、幸运草、蓝天白云）。'],
            en: ['🌱 Meadow green and ☁️ sky blue are now full themes (hills and clovers, blue sky and clouds).'],
        },
    },
    {
        v: '0.13.25',
        new: {
            'zh-TW': ['🌸 花朵粉色主題：花圈標題列、花瓣分頁、壓花貼紙。'],
            'zh-CN': ['🌸 花朵粉色主题：花圈标题栏、花瓣分页、压花贴纸。'],
            en: ['🌸 Blossom pink theme: flower-wreath header, petal tabs, pressed-flower stickers.'],
        },
    },
    {
        v: '0.13.22',
        new: {
            'zh-TW': ['📔 外觀可以選日系手帳主題，聊天裡的摘要區塊也能一起換。'],
            'zh-CN': ['📔 外观可以选日系手账主题，聊天里的摘要区块也能一起换。'],
            en: ['📔 A Japanese planner theme, optionally applied to the summary blocks in chat too.'],
        },
    },
    {
        v: '0.13.20',
        new: {
            'zh-TW': ['💝 回憶錄可以帶到同角色的新聊天（複製帶走或即時共用）。'],
            'zh-CN': ['💝 回忆录可以带到同角色的新聊天（复制带走或实时共享）。'],
            en: ['💝 The memory book can be carried into new chats with the same character (copy or share live).'],
        },
    },
    {
        v: '0.13.19',
        new: {
            'zh-TW': ['🌍 配角可以從世界書填寫。'],
            'zh-CN': ['🌍 配角可以从世界书填写。'],
            en: ['🌍 Supporting characters can be filled in from the lorebook.'],
        },
    },
    {
        v: '0.13.18',
        new: {
            'zh-TW': ['約定記得更完整（要做什麼、什麼時候、誰答應誰），行程也併進約定。'],
            'zh-CN': ['约定记得更完整（要做什么、什么时候、谁答应谁），行程也并进约定。'],
            en: ['Promises are recorded in more detail (what, when, who promised whom), and plans are merged into promises.'],
        },
    },
];

/** 比較版本號：a 比 b 新回傳正數。 */
export function compareVersions(a, b) {
    const pa = String(a).split('.').map((x) => Number(x) || 0);
    const pb = String(b).split('.').map((x) => Number(x) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d) return d;
    }
    return 0;
}

const pick = (byLocale) => (byLocale ? (byLocale[currentLocale()] ?? byLocale['zh-TW'] ?? []) : []);

/** 一個版本的內容：{ v, news: [...], fixes: [...] }（照目前語言）。 */
export function entryText(entry) {
    return { v: entry.v, news: pick(entry.new), fixes: pick(entry.fix) };
}

/** 看過的版本；空字串表示有這個功能之前就裝了（只顯示這一版的）。 */
export function seenVersion() {
    return getSettings().ui?.seenVersion ?? '';
}

/** 還沒看過的更新（新的在前）。沒有就回傳空陣列。 */
export function unseenChanges() {
    const seen = seenVersion();
    if (seen && compareVersions(seen, VERSION) >= 0) return [];
    return CHANGES
        .filter((c) => compareVersions(c.v, VERSION) <= 0 && (seen ? compareVersions(c.v, seen) > 0 : c.v === VERSION))
        .map(entryText)
        .filter((c) => c.news.length || c.fixes.length);
}

export function hasNews() {
    return unseenChanges().length > 0;
}

/**
 * 魔術棒、擴充設定的 NEW（v0.13.41，使用者要求：只在有更新時顯示）：
 * 有沒看過的更新、而且這一版還沒打開過大視窗才標。打開大視窗就算看到了，更新卡片照樣等「知道了」才收。
 */
export function showNewBadge() {
    return hasNews() && getSettings().ui?.badgeVersion !== VERSION;
}

/** 打開了大視窗：這一版的 NEW 不再標。 */
export function markBadgeSeen() {
    const s = getSettings();
    if (s.ui?.badgeVersion === VERSION) return;
    s.ui = { ...(s.ui ?? {}), badgeVersion: VERSION };
    saveSettings();
    for (const fn of listeners) fn();
}

const listeners = new Set();
export function onSeenChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** 按了「知道了」。 */
export function markSeen() {
    const s = getSettings();
    s.ui = { ...(s.ui ?? {}), seenVersion: VERSION };
    saveSettings();
    for (const fn of listeners) fn();
}

export function allChanges() {
    return CHANGES.filter((c) => compareVersions(c.v, VERSION) <= 0).map(entryText);
}
