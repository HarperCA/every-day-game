// 代读网页（美国服务器这一端，2026-11-09）：美国维护读网页是网络问题读不到时（国内网站从美国访问不稳），经这里请北京代读，北京读完把结果交回。
// 签名、5 分钟时效和公开比赛同步共用（../公开比赛同步/格式.mjs，同步秘钥 SYNC_SECRET）。格式见 北京端.mjs 和同目录 README.md。
// 什么时候改请北京由 美国/web/读网页/北京兜底.mjs 的 带北京兜底 决定，这里只管请求；新维护经 美国/web/index.mjs 拿到它（新维护不能直接引用 沟通/）。
//
//   代读(网址, { 方式: '网页' | '源码', etag, 最后修改, endpoint, 秘钥, fetchImpl, signal, 超时, now })
//     → 方式“网页”：和 读网页() 一样的统一结果 { url, finalUrl, status, httpStatus, contentType, title, text, links, error, ms, fetchedAt }
//     → 方式“源码”：和 取源码() 一样的结果 { url, finalUrl, status, httpStatus, html, etag, 最后修改, error }
//     北京读到什么就原样交回（北京那边的安全检查、robots 不通过也是北京的结果）。
//     没配地址或秘钥、连不上北京、北京太久不回（默认 60 秒）、北京不收（签名不对、过期……）、交回的不是结果：
//     交回对应格式、状态“网络错误”、error 写“北京代读失败：…”的结果，不抛。
//   endpoint：北京的 https://…/sync/fetch（环境变量 BEIJING_FETCH_ENDPOINT，由调用方读）
import { 时间头, 签名, 签名头 } from '../公开比赛同步/格式.mjs';

export const 默认超时 = 60_000;   // 北京读一页最多 15 秒，加上 robots、同一网站排队，留够余量

function 失败结果(网址, 方式, error) {
  if (方式 === '源码') return { url: 网址, finalUrl: null, status: '网络错误', httpStatus: null, html: '', etag: null, 最后修改: null, error };
  return { url: 网址, finalUrl: 网址, status: '网络错误', httpStatus: null, contentType: '', title: '', text: '', links: [], error, ms: null, fetchedAt: new Date().toISOString() };
}

export async function 代读(网址, { 方式 = '网页', etag = null, 最后修改 = null, endpoint, 秘钥, fetchImpl = globalThis.fetch, signal, 超时 = 默认超时, now = () => Date.now() } = {}) {
  const 失败 = 原因 => 失败结果(网址, 方式, `北京代读失败：${原因}`);
  if (!['网页', '源码'].includes(方式)) return 失败(`方式只能是 网页 或 源码，不是 ${方式}`);
  if (!endpoint || !秘钥) return 失败('没配北京代读地址或同步秘钥（BEIJING_FETCH_ENDPOINT、SYNC_SECRET）');
  try {
    const 正文 = JSON.stringify({ 网址, 方式, ...(etag ? { etag } : {}), ...(最后修改 ? { 最后修改 } : {}) });
    const 时间 = now();
    const 停 = signal ? AbortSignal.any([signal, AbortSignal.timeout(超时)]) : AbortSignal.timeout(超时);
    const 回应 = await fetchImpl(endpoint, {
      method: 'POST', body: 正文, signal: 停,
      headers: { 'Content-Type': 'application/json', [时间头]: String(时间), [签名头]: 签名(秘钥, 时间, 正文) },
    });
    const 回 = await 回应.json().catch(() => null);
    if (!回应.ok || !回?.ok) return 失败(`北京回 HTTP ${回应.status}${回?.message ? ` ${回.message}` : ''}`);
    const 结果 = 回.结果;
    if (!结果 || typeof 结果 !== 'object' || typeof 结果.status !== 'string') return 失败('北京交回的不是读取结果');
    return 结果;
  } catch (error) {
    if (error?.name === 'TimeoutError') return 失败(`超过 ${超时 / 1000} 秒北京没回`);
    return 失败(`${error?.message || error}${error?.cause?.code ? `（${error.cause.code}）` : ''}`.slice(0, 200));
  }
}
