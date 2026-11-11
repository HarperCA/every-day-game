// Jev（经 OpenRouter 的 decisions 接口，模型 typesafe/jev-1.13）特有的部分。只会一种能力：
//   decide  给一组“选择题”（每题列出可选类别和判断说明）和要判断的材料，交回每题选了什么、各类别的概率。
//           候选分类（03 筛选）、详情页挑链接（04 读正文）都用它；题目怎么出、概率多少算有把握，由调用方定。
// 注意：OpenRouter 从国内访问不稳，这家只在美国服务器上用。
//
// 来源：crawler/lib/jevCandidateFilter.mjs、crawler/lib/jevLinkRanker.mjs。
import { AiError } from '../../common/errors.mjs';
import { failIfNotOk, postJson } from '../../common/http.mjs';

const ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';

export function createJev({ fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  return {
    name: 'jev',
    async decide({ model = 'typesafe/jev-1.13', state, questions, key, signal }) {
      if (!questions || typeof questions !== 'object' || !Object.keys(questions).length) throw new AiError('请求有误', 'Jev 判断要给至少一道题', { provider: 'jev' });
      const res = await postJson(ENDPOINT, { headers: { Authorization: `Bearer ${key}` }, body: { model, state, questions }, timeoutMs, signal, fetchImpl, provider: 'jev' });
      failIfNotOk(res, 'jev');
      const answers = res.payload?.answers;
      if (!answers || typeof answers !== 'object') throw new AiError('对方出错', 'Jev 返回里没有 answers', { provider: 'jev', status: res.status });
      return {
        answers: Object.fromEntries(Object.keys(questions).map(id => {
          const answer = answers[id] || {};
          return [id, { choice: answer.choice ?? null, probabilities: answer.probabilities || {} }];
        })),
        tokensIn: res.payload?.usage?.prompt_tokens ?? null,
        tokensOut: res.payload?.usage?.completion_tokens ?? null,
      };
    },
  };
}

export const name = 'jev';
const defaultClient = createJev();
export const decide = args => defaultClient.decide(args);
export function classifyError() { return null; }
