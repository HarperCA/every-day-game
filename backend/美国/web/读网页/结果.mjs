// 统一的读取结果：不管读的是网页、PDF 还是 Word，读网页 交回的都是这个形状。
// 调用方只看 status 就知道这一条是成功、该标失败，还是该顺延。
//
//   {
//     url, finalUrl,          原网址、跳转后的最终网址
//     status,                 见 STATUSES
//     httpStatus, contentType,
//     title, text,            标题、正文（正文由调用方存进 run.db 的大块内容表）
//     links: [{ url, text, kind }],   页面里的链接；kind 是 通知/附件/报名入口/其他
//     error,                  失败时的原因（给人看的一句话）
//     ms, fetchedAt,
//   }

import { LINK_KINDS } from '../正文/index.mjs';

export { LINK_KINDS };
// 读不出文字：PDF、Word 下载下来了，但解析不出文字（坏文件、扫描件）
export const STATUSES = ['成功', '网址不安全', 'robots不允许', 'HTTP错误', '超时', '太大', '不支持的类型', '读不出文字', '正文太短', '网络错误', '内部错误'];
// 读成功但正文不到这么多字，算“正文太短”：多半是动态加载的网页，只读到了空壳
export const MIN_TEXT_CHARS = 300;
// 下一晚可以再试的：网络、超时、对方 5xx；其余（robots 不允许、网址不安全、类型不支持……）再试也一样
const RETRYABLE = new Set(['超时', '网络错误']);

export function makeResult(fields) {
  return {
    url: fields.url,
    finalUrl: fields.finalUrl ?? fields.url,
    status: fields.status,
    httpStatus: fields.httpStatus ?? null,
    contentType: fields.contentType ?? '',
    title: fields.title ?? '',
    text: fields.text ?? '',
    links: fields.links ?? [],
    error: fields.error ?? '',
    ms: fields.ms ?? null,
    fetchedAt: fields.fetchedAt ?? new Date().toISOString(),
  };
}

export const failed = (url, status, error, extra = {}) => makeResult({ url, status, error, ...extra });

export function isRetryable(result) {
  return RETRYABLE.has(result.status) || (result.status === 'HTTP错误' && result.httpStatus >= 500);
}

// 检查一个结果是否合格（测试和调用方用）
export function checkResult(result) {
  const errors = [];
  if (!result || typeof result !== 'object') return ['不是对象'];
  if (typeof result.url !== 'string' || !result.url) errors.push('缺少 url');
  if (!STATUSES.includes(result.status)) errors.push(`status「${result.status}」不在 ${STATUSES.join('/')} 里`);
  if (typeof result.text !== 'string') errors.push('text 必须是文字');
  if (!Array.isArray(result.links) || result.links.some(l => typeof l?.url !== 'string' || !LINK_KINDS.includes(l.kind))) errors.push('links 格式不对');
  if (result.status !== '成功' && !result.error) errors.push('失败的结果要写明原因 error');
  return errors;
}
