// 网址规范化：只去掉已知的跟踪参数（utm_*、fbclid、gclid），保留语言、地区、分页和签名。
// 搬自 scripts/crawler/lib/urlPolicy.mjs 的 normalizeCrawlUrl（线上和仓库两份内容一致）。
// 读网页 先用它规范化网址；01 搜索合并同一网址的结果也用它（经入口 index.mjs）。

export function normalizeUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('unsupported_url');
  url.hash = '';
  // 带签名的网址必须原样保留，改了参数签名就对不上
  if (![...url.searchParams.keys()].some(key => /signature|^sig$|^token$|^ticket$|^x-amz-/i.test(key))) {
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$/i.test(key)) url.searchParams.delete(key);
  }
  return url.href;
}

// 网站键：同一网站之间要间隔一段时间，用主机名区分网站
export function hostOf(value) {
  try { return new URL(value).hostname.toLowerCase(); } catch { return ''; }
}
