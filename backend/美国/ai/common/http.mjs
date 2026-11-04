// 各家接口共用的发请求：POST JSON、超时（和调用方的停止信号合并）、读回正文、HTTP 错误归到统一类型。
// 只管“怎么发”，不管发给谁、发什么；每家接口在自己的文件夹里拼地址和内容。
import { AiError, kindFromStatus } from './errors.mjs';

export async function postJson(url, { headers = {}, body, timeoutMs = 60000, signal, fetchImpl = globalThis.fetch, provider }) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const raw = await response.text();
  let payload = null;
  try { payload = JSON.parse(raw); } catch { /* 出错时也可能返回网页 */ }
  return { ok: response.ok, status: response.status, raw, payload };
}

// 不成功就按状态码抛统一类型的错（报错里只留前 200 字）
export function failIfNotOk({ ok, status, raw, payload }, provider) {
  if (ok) return;
  const kind = kindFromStatus(status) || '对方出错';
  const detail = payload?.error?.message || payload?.message || raw || '';
  throw new AiError(kind, `${provider} 返回 ${status}：${String(detail).slice(0, 200)}`, { provider, status });
}

// 搜索结果统一成 { title, url, content, date }，去掉空网址，最多 limit 条
const clip = (value, n) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, n);
export function normalizeReferences(items, limit = 10) {
  return (items || [])
    .map(item => ({ title: clip(item?.title, 200), url: String(item?.url || ''), content: clip(item?.content || item?.snippet, 600), date: clip(item?.date || item?.publishedAt, 20) }))
    .filter(item => item.url)
    .slice(0, limit);
}
