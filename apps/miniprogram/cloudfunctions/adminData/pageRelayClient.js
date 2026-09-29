// 国内网页中转的客户端（中转本身是腾讯云开发上海的云函数 pageRelay，见 cloudfunctions/pageRelay）。
// 服务器在美国，部分国内网站直接访问会连不上、超时或 403；这时改由中转去取。
// 配置：环境变量 RELAY_ENDPOINT / RELAY_SECRET，或 /opt/daily-contest/.relay-endpoint、.relay-secret。
// 没有配置时（比如本地开发、测试）整段不生效，行为和原来一样。
const fs = require('node:fs');
const path = require('node:path');

// 服务器上这个文件有两份：functions/adminData/（后端）和 cjs/（抽字段脚本用的副本），配置文件在 /opt/daily-contest
const CONFIG_DIRS = [process.env.RELAY_DIR, path.resolve(__dirname, '..', '..'), path.resolve(__dirname, '..')].filter(Boolean);

// 只有“网络层面打不开”才值得走中转；412 这类反爬验证是对方明确拦爬虫，不走
const RELAY_WORTHY = new Set(['network_error', 'timeout', 'unreachable', 'http_403']);
const shouldRelay = status => RELAY_WORTHY.has(status);

function readFile(name) {
  for (const dir of CONFIG_DIRS) {
    try { return fs.readFileSync(path.join(dir, name), 'utf8').trim(); } catch { /* 下一个 */ }
  }
  return '';
}

function relayConfig() {
  const endpoint = process.env.RELAY_ENDPOINT || readFile('.relay-endpoint');
  const secret = process.env.RELAY_SECRET || readFile('.relay-secret');
  return endpoint && secret ? { endpoint, secret } : null;
}

// 返回 { status, httpStatus, finalUrl, contentType, buffer, tlsUnverified }；中转本身调用失败时 status 为 relay_failed
async function relayFetch(url, config = relayConfig(), { fetchImpl = globalThis.fetch, timeoutMs = 30000 } = {}) {
  if (!config || typeof fetchImpl !== 'function') return { status:'relay_disabled' };
  try {
    const response = await fetchImpl(config.endpoint, {
      method:'POST', headers:{ 'content-type':'application/json' },
      body:JSON.stringify({ url, secret:config.secret }), signal:AbortSignal.timeout(timeoutMs),
    });
    const data = await response.json();
    if (data?.ok === false) return { status:`relay_${data.status || 'failed'}` };
    return {
      status:data.status, httpStatus:data.httpStatus, finalUrl:data.finalUrl || url, contentType:data.contentType || '',
      buffer:data.bodyBase64 ? Buffer.from(data.bodyBase64, 'base64') : null, tlsUnverified:Boolean(data.tlsUnverified), error:data.error,
    };
  } catch (error) {
    return { status:'relay_failed', error:String(error?.message || error).slice(0, 200) };
  }
}

module.exports = { relayConfig, relayFetch, shouldRelay };
