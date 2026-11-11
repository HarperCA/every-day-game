// 带身份的会话：来源（每晚自动化/实时/手动测试）、运行编号、模块、车道。会话里的每次调用都自动按这个身份记账。
// 调用方只拿到下面几个函数，看不到密钥、模型名和接口地址：
//   chat({ purpose, messages, json, tools, toolChoice, schema, promptVersion, signal })   对话 → { message, data, usage, provider }
//                                                                             toolChoice：带工具时让模型 auto/none/required（不给由接口默认）
//   search({ purpose = 'search', query, site, recent, blocked, signal })     搜索 → { references: [{ title, url, content, date }], provider, tried }
//                                                                             blocked：不要的网站（屏蔽名单由调用方给，目前只有百度认）
//                                                                             rewrite：false 时关掉百度的改写查询（不给按百度默认开着；别家不认）
//   fetchPage({ purpose = 'reread', url, signal })                            读网页 → { markdown, images, provider }
//   decide({ purpose, state, questions, signal })                             判断 → { answers: { 题号: { choice, probabilities } } }
//   budgetLeft()                                                              这个会话还剩多少次调用
//   报告问题({ purpose, promptVersion, 原因 })                                 接口调用成功了但内容用不了时，调用方报告给 AI 总管记下（不占调用次数）
//
// 额度：车道配置里的 budget 是每个会话最多调用多少次（null 表示不限）。用完时抛“额度用完”，调用方把还没处理的条目标成顺延。
import { createBudget } from '../../../共用/工具/budget.mjs';
import { AiError } from './errors.mjs';

export function createSession({ source, runId = null, module = null, lane = 'batch' } = {}, { call, config, usage }) {
  if (!source) throw new AiError('请求有误', '开会话要写明来源，比如“每晚自动化”“实时”或“手动测试”');
  const limit = config.lanes[lane]?.budget;
  const budget = createBudget(limit == null ? {} : { calls: limit });
  const identity = { source, runId, module };
  const take = () => {
    if (!budget.use('calls')) throw new AiError('额度用完', `会话 ${module || source} 的调用次数已用完（上限 ${limit}）`);
  };
  return {
    identity,
    async chat({ purpose, messages, json = false, tools = null, toolChoice = null, schema = null, promptVersion = null, signal } = {}) {
      take();
      return call({ purpose, capability: 'chat', request: { messages, json, tools, toolChoice, schema }, json, promptVersion, identity, lane, signal });
    },
    async search({ purpose = 'search', query, site = '', recent = '', blocked = [], rewrite, signal } = {}) {
      take();
      return call({ purpose, capability: 'search', request: { query, site, recent, blocked, ...(rewrite === false ? { rewrite } : {}) }, identity, lane, signal });
    },
    async fetchPage({ purpose = 'reread', url, signal } = {}) {
      take();
      return call({ purpose, capability: 'fetchPage', request: { url }, identity, lane, signal });
    },
    async decide({ purpose, state, questions, signal } = {}) {
      take();
      return call({ purpose, capability: 'decide', request: { state, questions }, identity, lane, signal });
    },
    budgetLeft: () => budget.left('calls'),
    报告问题({ purpose, promptVersion = null, 原因 } = {}) {
      if (!原因) throw new AiError('请求有误', '报告问题要写明原因');
      usage.recordProblem({ identity, purpose, promptVersion, reason: 原因 });
    },
  };
}
