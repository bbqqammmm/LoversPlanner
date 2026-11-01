// 思考程度（v0.13.58，使用者要求：做摘要這類工作時可以限制模型思考，像很多地方能選的「不思考／低／中／高」）。
//
// 只用在自訂 API（和其他組）；酒館主 API 的思考程度在酒館自己的連線設定裡調。
// 每家服務商的參數不一樣，所以每組 API 可以選格式，預設照網址猜：
//   effort     reasoning_effort: none|low|medium|high（OpenAI、Gemini 和大部分相容的中轉）
//   openrouter reasoning: { effort } ／ { enabled: false }（OpenRouter）
//   budget     enable_thinking＋thinking_budget（Qwen、硅基流動、魔搭）
//   switch     thinking: { type: enabled|disabled }（智譜 GLM、火山方舟、Kimi、DeepSeek）：只有開關，沒有高低
// 服務商不認得這個參數時（HTTP 400 說參數不對），custom.js 會拿掉它重送一次，llm.js 記下這組 API 不收這種格式。

export const THINKING_LEVELS = ['', 'off', 'low', 'medium', 'high'];
export const THINKING_FORMATS = ['auto', 'effort', 'openrouter', 'budget', 'switch'];

/** budget 格式：每一級給多少思考 token。 */
const BUDGET = { low: 1024, medium: 4096, high: 16384 };

/** 照網址猜格式。 */
export function detectFormat(url) {
    const host = String(url ?? '').toLowerCase();
    if (/openrouter\.ai/.test(host)) return 'openrouter';
    if (/siliconflow|dashscope|aliyuncs|modelscope/.test(host)) return 'budget';
    if (/bigmodel\.cn|z\.ai|volces|volcengine|moonshot|deepseek\.com/.test(host)) return 'switch';
    return 'effort';
}

/** 這組 API 實際用的格式（選「自動」就照網址猜）。 */
export function resolveFormat(cfg) {
    const f = cfg?.thinkingFormat;
    return THINKING_FORMATS.includes(f) && f !== 'auto' ? f : detectFormat(cfg?.url);
}

/** 要加進請求的參數；level 是空的（不指定）就不加。 */
export function thinkingParams(level, format) {
    if (!level || !THINKING_LEVELS.includes(level)) return {};
    const off = level === 'off';
    switch (format) {
        case 'openrouter': return { reasoning: off ? { enabled: false } : { effort: level } };
        case 'budget': return off ? { enable_thinking: false } : { enable_thinking: true, thinking_budget: BUDGET[level] };
        case 'switch': return { thinking: { type: off ? 'disabled' : 'enabled' } };
        default: return { reasoning_effort: off ? 'none' : level };
    }
}

/** HTTP 錯誤的說明看起來是在說這些參數不對（不認得、不支援、值不對）。 */
export function rejectsThinking(status, detail) {
    // 0：走酒館後端轉發時，服務商的錯誤包在回覆裡，沒有狀態碼。
    if (![0, 400, 422].includes(Number(status) || 0)) return false;
    return /reasoning|thinking|effort|budget/i.test(String(detail ?? ''));
}
