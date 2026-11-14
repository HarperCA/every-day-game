// 下载：把一个网址的内容原样取下来，不管里面写的是什么。只提供函数，由 读网页 调用。
// 搬自 scripts/crawler/lib/fetcher.mjs 的 getDirect 和 urlPolicy.mjs 的 readLimitedBody（超时、跳转、大小、类型的规矩不变）。
//
//   下载(网址, { signal, fetchImpl, 超时, 最大字节, 最多跳转, 跳转前检查, 额外头 }) → { finalUrl, httpStatus, contentType, body, etag, 最后修改 }
//   额外头：比如 if-none-match、if-modified-since（2026-11-08 新维护问网站有没有更新）；网站回 304 时交回 httpStatus 304、body 为空
//   出错时抛 下载出错，kind 是 超时 / 太大 / 网络错误 / HTTP错误 / 不支持的类型 / 网址不安全
//
// 跳转不交给 fetch 自动跟：每一跳之前调 跳转前检查(新网址)（读网页 在这里做安全检查和 robots），交回原因就停。
// 美国服务器没有 IPv6，连国内网站建连约 0.3 秒；Node 默认 250 毫秒就放弃 IPv4 改试 IPv6，整站超时，所以放宽到 2 秒。
import net from 'node:net';

export const USER_AGENT = 'competition-crawler/1.0 (+admin source verification; respects robots.txt)';
export const 默认 = { 超时: 20000, 最大字节: 8 * 1024 * 1024, 最多跳转: 5 };
// force-download、octet-stream：不少平台的附件下载用这种类型，按文件内容再判断是 PDF 还是 Word
const 收的类型 = /^(text\/html|application\/xhtml\+xml|application\/json|text\/plain|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/force-download|application\/octet-stream|application\/x-download)(;|$)/i;

if (net.getDefaultAutoSelectFamilyAttemptTimeout?.() < 2000) net.setDefaultAutoSelectFamilyAttemptTimeout(2000);

export class 下载出错 extends Error {
  constructor(kind, message, { httpStatus = null } = {}) {
    super(message);
    this.kind = kind;
    this.httpStatus = httpStatus;
  }
}

// 边读边数字节，超过上限马上停，不把大文件整个读进内存
export async function 限量读取(response, 最大字节) {
  if (Number(response.headers.get('content-length')) > 最大字节) {
    await response.body?.cancel();
    throw new 下载出错('太大', `超过 ${最大字节} 字节`);
  }
  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 最大字节) { await reader.cancel(); throw new 下载出错('太大', `超过 ${最大字节} 字节`); }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export async function 下载(网址, { signal, fetchImpl = globalThis.fetch, 超时 = 默认.超时, 最大字节 = 默认.最大字节, 最多跳转 = 默认.最多跳转, 跳转前检查 = async () => null, 额外头 = {} } = {}) {
  // 总时长超时（不是连接空闲超时），和调用方的停止信号合在一起
  const 停 = signal ? AbortSignal.any([signal, AbortSignal.timeout(超时)]) : AbortSignal.timeout(超时);
  let url = 网址;
  for (let 跳 = 0; ; 跳++) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,application/json,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.7', ...额外头 },
        signal: 停,
        redirect: 'manual',
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || (error?.name === 'AbortError' && !signal?.aborted)) throw new 下载出错('超时', `超过 ${超时 / 1000} 秒没下载完`);
      throw new 下载出错('网络错误', `${error?.message || error}${error?.cause?.code ? `（${error.cause.code}）` : ''}`.slice(0, 200));
    }
    const location = response.headers.get('location');
    if ([301, 302, 303, 307, 308].includes(response.status) && location) {
      await response.body?.cancel();
      if (跳 >= 最多跳转) throw new 下载出错('HTTP错误', `跳转超过 ${最多跳转} 次`, { httpStatus: response.status });
      const next = new URL(location, url).href;
      const 原因 = await 跳转前检查(next);
      if (原因) throw new 下载出错('网址不安全', `跳转到 ${next}：${原因}`);
      url = next;
      continue;
    }
    const 版本标记 = { etag: response.headers.get('etag'), 最后修改: response.headers.get('last-modified') };
    if (response.status === 304) {
      await response.body?.cancel();
      return { finalUrl: url, httpStatus: 304, contentType: '', body: Buffer.alloc(0), ...版本标记 };
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new 下载出错('HTTP错误', `对方返回 ${response.status}`, { httpStatus: response.status });
    }
    const contentType = response.headers.get('content-type') || '';
    if (!收的类型.test(contentType)) {
      await response.body?.cancel();
      throw new 下载出错('不支持的类型', `不读这种内容：${contentType || '未知类型'}`, { httpStatus: response.status });
    }
    try {
      return { finalUrl: url, httpStatus: response.status, contentType, body: await 限量读取(response, 最大字节), ...版本标记 };
    } catch (error) {
      if (error instanceof 下载出错) throw error;
      if (error?.name === 'TimeoutError') throw new 下载出错('超时', `超过 ${超时 / 1000} 秒没下载完`);
      throw new 下载出错('网络错误', String(error?.message || error).slice(0, 200));
    }
  }
}
