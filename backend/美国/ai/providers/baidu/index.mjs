// 百度千帆 AI 搜索特有的部分。只会一种能力：
//   search  网页搜索，返回标题、网址、摘要、日期；是搜索补位的第一家（月度免费额度、官网排名最好）。
// 每天的次数上限（自动任务默认 30 次，环境变量 BAIDU_DAILY_LIMIT 可改；手动测试不算）由 ../../common/config.mjs 的 DAILY_LIMITS 管，用量库计数，不另记文件。
// 屏蔽网站（转载、问答、聚合站、公众号文章）由调用方经 blocked 传进来，名单本身是业务规则，不放在这里。
//
// 来源：search-engines.mjs 的 baiduEngine、baiduSearchBody。官方参数说明：https://cloud.baidu.com/doc/qianfan-api/s/Wmbq4z7e5
import { failIfNotOk, normalizeReferences, postJson } from '../../common/http.mjs';

const ENDPOINT = 'https://qianfan.baidubce.com/v2/ai_search/web_search';
export const RECENCY = ['week', 'month', 'semiyear', 'year'];

// 网址或域名只留主机名（去掉协议、路径、端口）；不像域名的交回空（不限网站）
export function normalizeSite(value) {
  const host = String(value || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : '';
}

export function searchBody(query, { site = '', recent = '', blocked = [], limit = 10 } = {}) {
  const host = normalizeSite(site);
  return {
    messages: [{ content: query, role: 'user' }],
    search_source: 'baidu_search_v2',
    resource_type_filter: [{ type: 'web', top_k: limit }],
    ...(blocked.length ? { block_websites: blocked } : {}),
    query_policy: { enable_rewrite: true },
    ...(host ? { search_filter: { match: { site: [host] } } } : {}),
    ...(RECENCY.includes(recent) ? { search_recency_filter: recent } : {}),
  };
}

export function createBaidu({ fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  return {
    name: 'baidu',
    async search({ query, site = '', recent = '', blocked = [], key, signal }) {
      const res = await postJson(ENDPOINT, { headers: { 'X-Appbuilder-Authorization': `Bearer ${key}` }, body: searchBody(query, { site, recent, blocked }),
        timeoutMs, signal, fetchImpl, provider: 'baidu' });
      failIfNotOk(res, 'baidu');
      return { references: normalizeReferences(res.payload?.references) };
    },
  };
}

export const name = 'baidu';
const defaultClient = createBaidu();
export const search = args => defaultClient.search(args);
export function classifyError() { return null; }
