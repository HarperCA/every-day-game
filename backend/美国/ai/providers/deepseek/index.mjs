// DeepSeek 特有的部分。会两种能力：
//   chat    对话（OpenAI 格式，/chat/completions）。思考模式由用途配置的 thinking 决定，默认关：开着慢，带 tools 时还要求每轮回传 reasoning_content，
//           否则返回 400；但要 JSON 时关思考会交回坏 JSON（2026-10-30 实测），所以要 JSON 的用途在配置里开。开着时思考内容随 message 交回。
//   search  联网搜索（Anthropic 兼容接口里的 web_search 工具，服务端执行）：只返回标题和网址，没有摘要和日期；搜索补位的最后一家。
//   search 带 searchApi: 'tools'（2026-11-07 找官网用）：DeepSeek 搜索 API（/v1/tools/search，按次计费，不按 token）；交回标题、网址、长摘要、日期、
//           权威等级（authority，-1–4）、相关度（rerank，0–3）、网站名。搜索词最长 128 字，site 拼成 site: 写在后面。
// 只管“怎么和 DeepSeek 打交道”，不管问什么；由 ../../common/call.mjs 调用。
//
// 来源：apps/miniprogram/cloudfunctions/assistant/deepseek.js（对话）、search-engines.mjs 的 deepseekEngine（搜索）。
import { AiError } from '../../common/errors.mjs';
import { failIfNotOk, normalizeReferences, postJson } from '../../common/http.mjs';

import { readChatStream } from './stream.mjs';

const DEFAULT_BASE_URL = 'https://api.deepseek.com';

export function createDeepseek({ baseUrl = process.env.AI_DEEPSEEK_BASE_URL || DEFAULT_BASE_URL, fetchImpl = globalThis.fetch,
  timeoutMs = 120000, searchTimeoutMs = 90000 } = {}) {
  const root = String(baseUrl).replace(/\/+$/, '');

  async function 搜索API({ query, site, count, key, signal }) {
    const body = { query: `${String(query || '').trim()}${site ? ` site:${site}` : ''}`.slice(0, 128), count };
    const res = await postJson(`${root}/v1/tools/search`, { headers: { Authorization: `Bearer ${key}` }, body, timeoutMs: searchTimeoutMs, signal, fetchImpl, provider: 'deepseek' });
    failIfNotOk(res, 'deepseek');
    const items = (res.payload?.results || []).map(r => ({ title: r.title, url: r.url, content: r.summary || r.snippet || '', date: String(r.date || '').slice(0, 10),
      authority_score: r.authority, rerank_score: r.rerank_score, website: r.site_name }));
    return { references: normalizeReferences(items, count), tokensIn: null, tokensOut: null };
  }

  return {
    name: 'deepseek',
    async chat({ model, messages, json = false, tools = null, toolChoice = null, thinking = false, stream = false, temperature, maxTokens, key, signal }) {
      const body = { model, messages, thinking: { type: thinking ? 'enabled' : 'disabled' } };
      if (temperature != null) body.temperature = temperature;
      if (maxTokens) body.max_tokens = maxTokens;
      if (tools) body.tools = tools;
      if (tools && toolChoice) body.tool_choice = toolChoice;
      if (json) body.response_format = { type: 'json_object' };
      if (stream) {
        body.stream = true;
        body.stream_options = { include_usage: true };
      }
      const res = await postJson(`${root}/chat/completions`, {
        headers: { Authorization: `Bearer ${key}` }, body, timeoutMs, signal, fetchImpl, provider: 'deepseek',
        readStream: stream ? readChatStream : undefined,
      });
      failIfNotOk(res, 'deepseek');
      const message = res.payload?.choices?.[0]?.message;
      if (!message) throw new AiError('对方出错', 'DeepSeek 返回里没有回答', { provider: 'deepseek', status: res.status });
      return { message, tokensIn: res.payload.usage?.prompt_tokens ?? null, tokensOut: res.payload.usage?.completion_tokens ?? null };
    },
    async search({ model = 'deepseek-flash', query, site = '', searchApi = null, count = 10, key, signal }) {
      if (searchApi === 'tools') return 搜索API({ query, site, count, key, signal });
      const body = { model, max_tokens: 1500, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }],
        messages: [{ role: 'user', content: `请只调用一次联网搜索工具，搜索词必须原样使用：${query}（不要改写）。搜索完不用总结，回复“完成”即可。` }] };
      const res = await postJson(`${root}/anthropic/v1/messages`, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body, timeoutMs: searchTimeoutMs, signal, fetchImpl, provider: 'deepseek' });
      failIfNotOk(res, 'deepseek');
      if (res.payload?.error) throw new AiError('对方出错', String(res.payload.error.message || res.payload.error.type || 'deepseek_error').slice(0, 120), { provider: 'deepseek' });
      const blocks = (res.payload?.content || []).filter(block => block.type === 'web_search_tool_result');
      const failed = blocks.find(block => !Array.isArray(block.content));
      const items = blocks.flatMap(block => (Array.isArray(block.content) ? block.content : []));
      if (!items.length && failed) throw new AiError('对方出错', `DeepSeek 搜索失败：${String(failed.content?.error_code || 'unknown').slice(0, 60)}`, { provider: 'deepseek' });
      return { references: normalizeReferences(items), tokensIn: res.payload?.usage?.input_tokens ?? null, tokensOut: res.payload?.usage?.output_tokens ?? null };
    },
  };
}

export const name = 'deepseek';
const defaultClient = createDeepseek();
export const chat = args => defaultClient.chat(args);
export const search = args => defaultClient.search(args);
export function classifyError() { return null; }   // 已经归好类；网络和超时交给 call.mjs 的 toAiError
