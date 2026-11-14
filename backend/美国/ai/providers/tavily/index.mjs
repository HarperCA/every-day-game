import { AiError } from '../../common/errors.mjs';
import { failIfNotOk, normalizeReferences, postJson } from '../../common/http.mjs';

const ENDPOINT = 'https://api.tavily.com/search';
export const name = 'tavily';

export async function search({ query, key, signal, fetchImpl = globalThis.fetch }) {
  const res = await postJson(ENDPOINT, {
    headers: { Authorization: `Bearer ${key}` },
    body: { query, search_depth: 'basic', max_results: 20 },
    timeoutMs: 20000,
    signal,
    fetchImpl,
    provider: name,
  });
  if ([432, 433].includes(res.status)) {
    throw new AiError('额度用完', `Tavily 返回 ${res.status}`, { provider: name, status: res.status });
  }
  failIfNotOk(res, name);
  if (!Array.isArray(res.payload?.results)) {
    throw new AiError('格式不对', 'Tavily 没有返回搜索结果列表', { provider: name });
  }
  return { references: normalizeReferences(res.payload.results, 20) };
}

export function classifyError() { return null; }   // 已经归好类；网络和超时交给 call.mjs 的 toAiError
