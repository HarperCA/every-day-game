// 网页中转：自有服务器在美国，部分国内网站（只收国内 IP、跨境握手常超时）直接打不开，
// 由这个部署在腾讯云开发（上海）的云函数代取网页，原样返回给服务器。2026-09-29 起。
//
// 只做“取网页”这一件事，限制：
//   - 必须带密钥（环境变量 RELAY_SECRET），否则拒绝——不能被别人当成免费代理；
//   - 只取公网 http/https 地址，解析出内网、本机、云内部地址的一律拒绝（跳转后也检查）；
//   - 遵守 robots.txt，用与服务器抓取相同的爬虫身份，不做伪装；
//   - 单次最多 15 秒、3MB，最多跟随 5 次跳转。
// 返回 { status, httpStatus, finalUrl, contentType, bodyBase64 }，编码由调用方按原逻辑处理（GBK、PDF 等）。
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns').promises;
const net = require('node:net');
const crypto = require('node:crypto');
const { isAllowed } = require('./robots');

const USER_AGENT = 'competition-crawler/1.0 (+admin source verification; respects robots.txt)';
const TIMEOUT_MS = 15000;
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 5;

function privateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('::ffff:');
}

// 云开发网络的系统解析对部分域名返回找不到（如辽宁省大学生创新创业平台），
// 失败时依次改用阿里、腾讯的公共 HTTP 解析。解析结果同样要过公网地址检查。
function getJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { timeout:5000 }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

const resolved = new Map();
async function resolveHost(hostname) {
  if (net.isIP(hostname)) return [hostname];
  if (resolved.has(hostname)) return resolved.get(hostname);
  // 系统解析和几个公共解析同时问，谁先给出地址用谁（系统解析失败时常要等十几秒，不能串行等）
  const name = encodeURIComponent(hostname);
  const onlyIps = list => { const ips = (Array.isArray(list) ? list : []).filter(net.isIPv4); if (!ips.length) throw new Error('empty'); return ips; };
  const asks = [
    dns.lookup(hostname, { all:true, family:4 }).then(list => onlyIps(list.map(item => item.address))),
    getJson(`http://223.5.5.5/resolve?name=${name}&type=A&short=1`).then(JSON.parse).then(onlyIps),
    getJson(`https://dns.alidns.com/resolve?name=${name}&type=A&short=1`).then(JSON.parse).then(onlyIps),
    getJson(`http://119.29.29.29/d?dn=${name}`).then(text => onlyIps(text.split(';'))),
  ];
  let addresses = [];
  try { addresses = await Promise.any(asks); } catch { /* 都失败 */ }
  if (!addresses.length) throw new Error(`dns_not_found:${hostname}`);
  resolved.set(hostname, addresses);
  return addresses;
}

async function assertPublic(target) {
  if (!/^https?:$/.test(target.protocol)) throw new Error('unsupported_protocol');
  const addresses = await resolveHost(target.hostname);
  if (addresses.some(privateAddress)) throw new Error('private_address');
}

// 连接时用上面解析出的地址（域名照旧用于 TLS 证书校验和 Host 头）
function lookup(hostname, options, callback) {
  resolveHost(hostname).then(addresses => {
    if (options && options.all) callback(null, addresses.map(address => ({ address, family:4 })));
    else callback(null, addresses[0], 4);
  }, callback);
}

// insecure：对方证书链不完整（缺中间证书，很多高校网站如此）时，浏览器会自动补全而程序不会；
// 这时改为不校验证书再取一次，结果里标明 tlsUnverified，只用于读取公开网页。
function requestOnce(target, insecure = false) {
  return new Promise((resolve, reject) => {
    const client = target.protocol === 'https:' ? https : http;
    const req = client.request(target, { method:'GET', lookup, rejectUnauthorized:!insecure, headers:{ 'User-Agent':USER_AGENT, 'Accept':'*/*', 'Accept-Language':'zh-CN,zh;q=0.9' }, timeout:TIMEOUT_MS }, res => {
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BYTES) { req.destroy(new Error('too_large')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ status:res.statusCode, headers:res.headers, body:Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function fetchFollow(url) {
  let target = new URL(url);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublic(target);
    let res;
    try { res = await requestOnce(target); }
    catch (error) {
      if (!/certificate|self.signed|UNABLE_TO_VERIFY/i.test(String(error?.message || error?.code))) throw error;
      res = { ...(await requestOnce(target, true)), tlsUnverified:true };
    }
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location) {
      target = new URL(res.headers.location, target);
      continue;
    }
    return { ...res, finalUrl:target.href };
  }
  throw new Error('too_many_redirects');
}

async function robotsAllows(target) {
  try {
    const res = await fetchFollow(`${target.origin}/robots.txt`);
    const text = res.status === 200 && !/html/i.test(res.headers['content-type'] || '') ? res.body.toString('utf8') : '';
    return !text || isAllowed(text, USER_AGENT, target.pathname + target.search);
  } catch {
    return true;   // 取不到 robots.txt 按惯例视为允许
  }
}

function secretMatches(given) {
  const expected = process.env.RELAY_SECRET || '';
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(expected);
  return expected.length >= 32 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 既能被 HTTP 访问服务调用（event.body 是 JSON 字符串），也能被直接调用（event 就是参数）
function readParams(event) {
  if (event && typeof event.body === 'string') {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return event || {};
}

exports.main = async event => {
  const params = readParams(event);
  if (!secretMatches(params.secret)) return { ok:false, status:'forbidden' };
  let target;
  try { target = new URL(String(params.url || '')); } catch { return { ok:false, status:'invalid_url' }; }
  try {
    await assertPublic(target);
    if (!(await robotsAllows(target))) return { ok:true, status:'blocked_by_robots', finalUrl:target.href };
    const res = await fetchFollow(target.href);
    return { ok:true, status:res.status >= 200 && res.status < 300 ? 'ok' : `http_${res.status}`, httpStatus:res.status, tlsUnverified:Boolean(res.tlsUnverified),
      finalUrl:res.finalUrl, contentType:res.headers['content-type'] || '', bodyBase64:res.body.toString('base64') };
  } catch (error) {
    const message = String(error?.message || error);
    return { ok:true, status:/timeout/i.test(message) ? 'timeout' : /too_large/.test(message) ? 'too_large' : /dns_not_found/.test(message) ? 'dns_not_found' : /private_address|unsupported_protocol/.test(message) ? message : 'network_error', error:message.slice(0, 200) };
  }
};
