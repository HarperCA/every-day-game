// 安全检查：只读公网的 http/https 网址。网址解析出来是内网、本机、云内部地址的一律拒绝，
// 防止被人借我们的服务器去访问它内部的东西。跳转以后的网址也要再查一次（由 fetch.mjs 在每次跳转时调用）。
// 内网地址的判断搬自上海 pageRelay 云函数的 privateAddress。
import dns from 'node:dns/promises';
import net from 'node:net';

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('::ffff:');
}

// 返回 null 表示安全；否则返回拒绝的原因
export async function checkUrlSafety(value, { lookup = host => dns.lookup(host, { all: true }) } = {}) {
  let url;
  try { url = new URL(value); } catch { return '网址格式不对'; }
  if (!['http:', 'https:'].includes(url.protocol)) return `只读 http/https，不读 ${url.protocol}`;
  if (url.username || url.password) return '网址里带了账号密码';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return '不读本机地址';
  if (net.isIP(host)) return isPrivateAddress(host) ? `不读内网地址 ${host}` : null;
  let addresses;
  try { addresses = await lookup(host); } catch { return null; }   // 解析失败交给下载那一步报“网络错误”
  const bad = addresses.find(a => isPrivateAddress(a.address));
  return bad ? `域名解析到内网地址 ${bad.address}` : null;
}
