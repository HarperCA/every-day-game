// 统一的错误类型：调用方按类型处理，不用看报错原文。
//
//   请求太多   429                 退避后重试
//   额度用完                      不重试，条目顺延
//   密钥错误   401、403、缺密钥    不重试，这家接口暂停，报告里醒目提示
//   请求有误   400、用途没配置      不重试，这一条失败
//   对方出错   5xx                 重试几次
//   超时、网络                     重试几次
//   格式不对   要 JSON 却不是       重试 1 次，再不对就算失败
//   已暂停     连续失败太多次       不重试，等暂停时间过去
export const ERROR_KINDS = ['请求太多', '额度用完', '密钥错误', '请求有误', '对方出错', '超时', '网络', '格式不对', '已暂停'];
const RETRYABLE = new Set(['请求太多', '对方出错', '超时', '网络', '格式不对']);

export class AiError extends Error {
  constructor(kind, message, { provider = null, status = null } = {}) {
    if (!ERROR_KINDS.includes(kind)) throw new Error(`未知的 AI 错误类型：${kind}`);
    super(message);
    this.name = 'AiError';
    this.kind = kind;
    this.provider = provider;
    this.status = status;
  }
  get retryable() { return RETRYABLE.has(this.kind); }
}

// 按 HTTP 状态码归类（各家接口特有的情况由 providers/ 里各自再细分）
export function kindFromStatus(status) {
  if (status === 429) return '请求太多';
  if (status === 401 || status === 403) return '密钥错误';
  if (status >= 500) return '对方出错';
  if (status >= 400) return '请求有误';
  return null;
}

// 不是 AiError 的意外错误，归成 AiError；超时和网络错误按名字认
export function toAiError(error, provider) {
  if (error instanceof AiError) return error;
  const name = error?.name || '';
  if (name === 'TimeoutError' || name === 'AbortError') return new AiError('超时', String(error?.message || error), { provider });
  return new AiError('网络', String(error?.message || error).slice(0, 300), { provider });
}
