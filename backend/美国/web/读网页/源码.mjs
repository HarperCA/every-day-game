// 取源码：交回网页的 HTML 源码（按编码转好），给新维护的爬虫脚本取选择器用（2026-11-08）。
// 和读网页同一套规矩：规范化网址 → 安全检查 → robots → 同一网站限速 → 下载（每次跳转前再查安全和 robots）。
// 给了上次的 etag、最后修改，就带 if-none-match、if-modified-since 去问；网站回 304 交回“没更新”，不下载正文。
//
//   取源码(网址, { signal, etag, 最后修改, 超时, 最大字节, 最多跳转, fetchImpl, 限速, 安全检查, robots }) → { url, finalUrl, status, httpStatus, html, etag, 最后修改, error }
//     status：成功 / 没更新 / 不支持的类型（不是网页）/ 读网页的那些失败状态（网址不安全、robots不允许、HTTP错误、超时、太大、网络错误、内部错误）
import { 下载 } from '../下载/index.mjs';
import { robots允许, 建robots检查 } from '../下载/robots.mjs';
import { 转文字 } from '../编码/index.mjs';
import { checkUrlSafety } from './安全.mjs';
import { hostOf, normalizeUrl } from './网址.mjs';
import { 默认限速 } from './限速.mjs';
import { 内容类型, 下载上限 } from './index.mjs';

export async function 取源码(网址, { signal, etag = null, 最后修改 = null, fetchImpl, 限速 = 默认限速, 安全检查 = checkUrlSafety, robots, 超时, 最大字节, 最多跳转 } = {}) {
  const 结果 = fields => ({ url: 网址, finalUrl: null, status: '内部错误', httpStatus: null, html: '', etag: null, 最后修改: null, error: '', ...fields });
  const 查robots = robots || (fetchImpl ? 建robots检查({ fetchImpl }) : robots允许);
  let url = 网址;
  try {
    try { url = normalizeUrl(网址); } catch { return 结果({ status: '网址不安全', error: '网址格式不对，或不是 http/https' }); }
    const 不安全 = await 安全检查(url);
    if (不安全) return 结果({ url, status: '网址不安全', error: 不安全 });
    if (!(await 查robots(url))) return 结果({ url, status: 'robots不允许', error: '网站的 robots.txt 不允许抓取' });
    await 限速.等候(hostOf(url));
    const 额外头 = { ...(etag ? { 'if-none-match': etag } : {}), ...(最后修改 ? { 'if-modified-since': 最后修改 } : {}) };
    let page;
    try {
      page = await 下载(url, { signal, 额外头, ...下载上限({ 超时, 最大字节, 最多跳转 }), ...(fetchImpl ? { fetchImpl } : {}),
        跳转前检查: async next => (await 安全检查(next)) || ((await 查robots(next)) ? null : 'robots.txt 不允许抓取') });
    } catch (error) {
      if (error?.kind) return 结果({ url, status: error.kind, error: error.message, httpStatus: error.httpStatus });
      throw error;
    }
    const base = { url, finalUrl: page.finalUrl, httpStatus: page.httpStatus, etag: page.etag ?? null, 最后修改: page.最后修改 ?? null };
    if (page.httpStatus === 304) return 结果({ ...base, status: '没更新' });
    if (内容类型(page.contentType, page.body, page.finalUrl) !== 'html') return 结果({ ...base, status: '不支持的类型', error: `不是网页：${page.contentType || '未知类型'}` });
    return 结果({ ...base, status: '成功', html: 转文字(page.body, page.contentType) });
  } catch (error) {
    return 结果({ url, status: '内部错误', error: String(error?.message || error) });
  }
}
