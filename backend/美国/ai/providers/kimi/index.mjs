// Kimi（会员通道 api.kimi.com/coding/v1）特有的部分。会三种能力：
//   chat       对话（OpenAI 格式）。这个通道不接受 temperature=0.1 和 JSON 结构约束，所以不带 temperature，要 JSON 时只用 json_object。
//   search     搜索（kimi-cli 的 SearchWeb 用的同一个接口）。5xx 等一会儿重试一次；带 site: 的搜索在那个网站没结果时接口报 500，
//              重试后仍是 500 按“没有结果”交回，不算故障（不然补位器会整晚停用 Kimi 搜索）。
//   fetchPage  读网页（kimi-cli 的 FetchURL 用的同一个接口）：在服务端执行页面脚本后交回正文，用来重读“空壳页”。
// 按月订阅，单次费用记 0。
//
// 来源：cjs/competitionAiReview.js（对话的参数）、search-engines.mjs 的 kimiEngine、kimiFetchPage。
import crypto from 'node:crypto';
import { AiError } from '../../common/errors.mjs';
import { failIfNotOk, normalizeReferences, postJson } from '../../common/http.mjs';

const DEFAULT_BASE_URL = 'https://api.kimi.com/coding/v1';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createKimi({ baseUrl = process.env.AI_KIMI_BASE_URL || DEFAULT_BASE_URL, fetchImpl = globalThis.fetch,
  timeoutMs = 180000, searchTimeoutMs = 40000, fetchTimeoutMs = 60000, retryDelayMs = 2000 } = {}) {
  const root = String(baseUrl).replace(/\/+$/, '');
  const auth = key => ({ Authorization: `Bearer ${key}` });
  const toolHeaders = key => ({ ...auth(key), 'X-Msh-Tool-Call-Id': crypto.randomUUID() });
  return {
    name: 'kimi',
    async chat({ model = 'kimi-for-coding', messages, json = false, tools = null, maxTokens, key, signal }) {
      const body = { model, messages };   // 不带 temperature：这个通道只接受默认值
      if (maxTokens) body.max_tokens = maxTokens;
      if (tools) body.tools = tools;
      if (json) body.response_format = { type: 'json_object' };
      const res = await postJson(`${root}/chat/completions`, { headers: auth(key), body, timeoutMs, signal, fetchImpl, provider: 'kimi' });
      failIfNotOk(res, 'kimi');
      const message = res.payload?.choices?.[0]?.message;
      if (!message) throw new AiError('对方出错', 'Kimi 返回里没有回答', { provider: 'kimi', status: res.status });
      return { message, tokensIn: res.payload.usage?.prompt_tokens ?? null, tokensOut: res.payload.usage?.completion_tokens ?? null };
    },
    async search({ query, key, signal, limit = 10 }) {
      const request = () => postJson(`${root}/search`, { headers: toolHeaders(key), body: { text_query: query, limit, enable_page_crawling: false, timeout_seconds: 30 },
        timeoutMs: searchTimeoutMs, signal, fetchImpl, provider: 'kimi' });
      let res = await request();
      if (res.status >= 500) { await sleep(retryDelayMs); res = await request(); }
      if (res.status === 500 && /(^|\s)site:\S/i.test(query)) return { references: [] };
      failIfNotOk(res, 'kimi');
      // 接口不一定遵守 limit（实测 limit=10 返回过 14 条），自己截断
      return { references: normalizeReferences(res.payload?.search_results, limit) };
    },
    async fetchPage({ url, key, signal }) {
      const res = await postJson(`${root}/fetch`, { headers: toolHeaders(key), body: { url }, timeoutMs: fetchTimeoutMs, signal, fetchImpl, provider: 'kimi' });
      failIfNotOk(res, 'kimi');
      const raw = String(res.payload?.markdown || res.payload?.content || '');
      // 页面里的图片地址是 Kimi 自己的图床：正文里去掉，地址单独交回给“识别页面图片”用
      const images = [...new Set([...raw.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map(m => m[1]))];
      const markdown = raw.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\n{3,}/g, '\n\n').trim();
      return { markdown, images };
    },
  };
}

export const name = 'kimi';
const defaultClient = createKimi();
export const chat = args => defaultClient.chat(args);
export const search = args => defaultClient.search(args);
export const fetchPage = args => defaultClient.fetchPage(args);
export function classifyError() { return null; }
