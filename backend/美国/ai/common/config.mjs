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
  audit: { 能力: 'chat', provider: 'codex', model: 'gpt-6.1-sol', effort: 'high', codexSearch: true, codexSearchLimit: { 搜索: 1, 打开: 5 }, note: 'AI 审查（维护/审计/核对原文）：只用 Codex，开内置搜索，程序再读网页逐字核对；一次调用就是一轮，只搜 1 次（2026-11-06 用户定最多 3 轮）；提示词写最多打开 3 个，打开 5 个才硬停，给页内查找留余地' },
  review: { 能力: 'chat', provider: 'kimi', model: 'kimi-for-coding', note: '入库前审核（05 审核），沿用旧系统的 Kimi' },
  verify: { 能力: 'chat', provider: 'kimi', model: 'kimi-for-coding', note: '三项核验（05 审核的 三项核验/；以后维护也用），沿用旧系统的 Kimi' },
  assistant: { 能力: 'chat', provider: 'deepseek', model: 'deepseek-flash', thinking: false, stream: true, temperature: 0.3, maxTokens: 800, note: '赛事助手（实时）；参数沿用旧助手' },
  // 搜索
  search: { 能力: 'search', provider: ['baidu', 'kimi', 'deepseek'], models: { deepseek: 'deepseek-flash' }, note: '找通知、补读正式通知、01 搜索；依次补位' },
  // 2026-11-07 用户定改法：像人一样只搜比赛名、取前 10 条（官网多数在里面：方案三的搜索结果 11 个已知官网里 8 个有），DeepSeek 只做选择题
  official_search: { 能力: 'search', provider: 'deepseek', searchApi: 'tools', count: 20, note: '找官网：只搜比赛名，DeepSeek 搜索 API（每千次 0.75 美元，不按 token）；要 20 条，去掉屏蔽网站后留前 10 条' },
  official_tavily: { 能力: 'search', provider: 'tavily', note: '找官网：DeepSeek 搜索未找到可用官网时补搜' },
  official_pick: { 能力: 'chat', provider: 'deepseek', model: 'deepseek-flash', thinking: true, maxTokens: 4000, note: '找官网：从前 10 条里选官网（选择题），不联网；要 JSON 所以开思考' },
  // 找新一届（2026-11-12 用户定）：已归档的比赛搜“比赛名 + 下一年/下一届”（搜索词里带 after:YYYY-MM-DD），DeepSeek 做选择题挑新一届的通知或转发，程序再核对。
  // 选择题单独一个用途：11-12 试验用 official_pick 的 4000 上限，思考把 token 用完、回答被截断，漏了蓝桥杯；这里调大，调用方也每批最多交 10 条
  new_edition_search: { 能力: 'search', provider: 'deepseek', searchApi: 'tools', count: 20, note: '找新一届：搜“比赛名 + 下一年/下一届 after:日期”，DeepSeek 搜索 API（按次计费）' },
  new_edition_pick: { 能力: 'chat', provider: 'deepseek', model: 'deepseek-flash', thinking: true, maxTokens: 16000, note: '找新一届：从搜索结果里挑新一届的通知或转发（选择题，每批最多 10 条），不联网；要 JSON 所以开思考' },
  // 新维护写爬虫脚本（2026-11-08 用户定）：Codex 看官网页面（程序先压缩）写一串步骤，程序试跑；本地试跑时试跑程序把它换成 Kimi
  crawl_script: { 能力: 'chat', provider: 'codex', model: 'gpt-6.1-sol', effort: 'high', note: '新维护：给比赛官网写爬虫脚本（打开、等待、点击、取列表的步骤），按 schema 交回 JSON；不联网、不跑命令' },
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
