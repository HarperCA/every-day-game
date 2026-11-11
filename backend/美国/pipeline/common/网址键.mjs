// 网址键：对比“是不是同一个网址”用。不分 http/https，去掉 www、结尾斜杠、# 锚点和跟踪参数（utm_*、fbclid、gclid），保留路径和其他参数。
// 规则和旧的 rejected-memory.mjs、crawler/lib/dedupe.mjs 的 urlKey 一样，另外去掉跟踪参数。02 对比去重和记拒过的网址都用它。
//   网址键(url) → 'example.cn/a/b?id=3'；不是 http/https 网址时交回 ''
export function 网址键(value) {
  try {
    const url = new URL(String(value || ''));
    if (!/^https?:$/.test(url.protocol)) return '';
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$/i.test(key)) url.searchParams.delete(key);
    const search = url.searchParams.toString();
    return `${url.hostname.replace(/^www\./, '').toLowerCase()}${url.pathname.replace(/\/+$/, '')}${search ? `?${search}` : ''}`;
  } catch {
    return '';
  }
}
