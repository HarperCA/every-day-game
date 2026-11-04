// 分发配置：每个用途用哪种能力、发给哪家接口、用哪个模型；车道；重试和暂停；每天的次数上限；价格。
// 调用方只说用途，换模型、换供应商只改这里，调用方的代码不动。
// 标“暂定”的数字只是让骨架能跑起来，正式的数字等统计近两周的真实用量后再定。
//
// 能力：对话（chat）、搜索（search）、读网页（fetchPage）、判断（decide）。一家接口会哪几种见 providers/*/index.mjs。
// provider 写成数组时依次补位：前一家额度用完、暂停、出错，换下一家（搜索沿用旧系统的 百度 → Kimi → DeepSeek）。
//
// 对话可以带的参数：thinking（DeepSeek 开不开思考）、temperature、maxTokens。
// 2026-10-30 在美国服务器实测：deepseek-flash 关思考时要 JSON，3 次里 2 次交回坏 JSON（混进 <|endoftext|> 之类），
// 开思考 3 次都对（多花几十个 token），所以要 JSON 的用途都开思考，和旧系统一样；赛事助手带工具，开思考会要求每轮回传思考内容，所以关。
export const PURPOSES = {
  // 对话
  extract: { 能力: 'chat', provider: 'deepseek', model: 'deepseek-flash', thinking: true, temperature: 0.1, maxTokens: 32000, note: '抽取字段（04 读详情和抽取）；参数沿用旧抽取' },
  admission: { 能力: 'chat', provider: 'deepseek', model: 'deepseek-chat', thinking: true, maxTokens: 8000, note: '收录再判（美国/程序审核 的收录门槛，05 审核调用）；参数沿用旧收录判断' },
  arbitrate: { 能力: 'chat', provider: 'deepseek', model: 'deepseek-flash', thinking: true, note: '判重裁决（02 对比去重）' },
  trace: { 能力: 'chat', provider: 'codex', model: 'gpt-6.1-sol', effort: 'xhigh', note: '通知追溯的每一步（03 筛选的 Codex 代理追踪）；模型和推理强度沿用 10-14 定的' },
  fill: { 能力: 'chat', provider: 'codex', model: 'gpt-6.1-sol', effort: 'xhigh', note: '补缺失字段的每一步（美国/补字段/，05 审核和维护的缺失字段共用；2026-11-03 用户定用 Codex 代理）；模型同 trace' },
  review: { 能力: 'chat', provider: 'kimi', model: 'kimi-for-coding', note: '入库前审核（05 审核），沿用旧系统的 Kimi' },
  verify: { 能力: 'chat', provider: 'kimi', model: 'kimi-for-coding', note: '三项核验（05 审核的 三项核验/；以后维护也用），沿用旧系统的 Kimi' },
  assistant: { 能力: 'chat', provider: 'deepseek', model: 'deepseek-flash', thinking: false, temperature: 0.3, maxTokens: 800, note: '赛事助手（实时）；参数沿用旧助手' },
  // 搜索
  search: { 能力: 'search', provider: ['baidu', 'kimi', 'deepseek'], models: { deepseek: 'deepseek-flash' }, note: '找通知、补读正式通知、01 搜索；依次补位' },
  // 读网页
  reread: { 能力: 'fetchPage', provider: 'kimi', model: null, note: '空壳页重读（04 读详情和抽取），在服务端执行页面脚本' },
  // 判断
  classify: { 能力: 'decide', provider: 'jev', model: 'typesafe/jev-1.13', note: '候选筛选（03 筛选）' },
};

// 车道：同一车道、同一家接口共用一个并发池；budget 是每个会话最多调用多少次，null 表示不限
export const LANES = {
  realtime: { concurrency: 4, budget: null, note: '赛事助手这类用户在等的调用（暂定）' },
  batch: { concurrency: 4, budget: null, note: '每晚流程（暂定）' },
};

// 每家接口每天（北京时间）最多调用多少次；来源是“手动测试”的不算、也不受限（沿用旧系统百度 BAIDU_MANUAL=1 的做法）
// 百度默认 30（2026-10-10 用户定：自动任务每天最多 30 次，其余留给测试）；环境变量 BAIDU_DAILY_LIMIT 可改（2026-11-03 新旧并行期间新旧各 15 次，名字和旧系统一样）
export function 每天上限(env = process.env) {
  const 设的 = Number(env.BAIDU_DAILY_LIMIT);
  return { baidu: Number.isInteger(设的) && 设的 > 0 ? 设的 : 30 };
}
export const DAILY_LIMITS = 每天上限();
export const MANUAL_SOURCE = '手动测试';

export const RETRY = { attempts: 3, backoffMs: 1000 };           // 最多试 3 次，等待时间翻倍（暂定）
export const BREAKER = { failures: 5, pauseMs: 10 * 60 * 1000 };   // 同一家连续失败 5 次，暂停 10 分钟（暂定）
export const JSON_RETRY = 1;                                       // 要 JSON 却解析不出来，再试 1 次

// 每百万 token 的价格（元），待填；没填的费用记成 null。Codex 按月订阅，单次记 0；Kimi 会员通道按月订阅，单次记 0。
export const PRICES = {
  codex: { input: 0, output: 0 },
  kimi: { input: 0, output: 0 },
};

export const DEFAULT_CONFIG = { purposes: PURPOSES, lanes: LANES, dailyLimits: DAILY_LIMITS, manualSource: MANUAL_SOURCE, retry: RETRY, breaker: BREAKER, jsonRetry: JSON_RETRY, prices: PRICES };
