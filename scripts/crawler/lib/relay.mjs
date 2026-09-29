// 国内网页中转客户端（抓取层用；后端 AI 审核用的是 cloudfunctions/adminData/pageRelayClient.js，规则相同）。
// 中转本身是腾讯云开发上海的云函数 pageRelay。服务器在美国，部分国内网站直接访问连不上、超时或 403，
// 这时改由中转去取。配置：环境变量 RELAY_ENDPOINT / RELAY_SECRET，
// 或服务器 /opt/daily-contest/.relay-endpoint、.relay-secret；没有配置时不生效。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG_DIR = process.env.RELAY_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RELAY_WORTHY = new Set(['network_error', 'timeout', 'http_403']);

export const shouldRelay = status => RELAY_WORTHY.has(status);

const readFile = name => { try { return fs.readFileSync(path.join(CONFIG_DIR, name), 'utf8').trim(); } catch { return ''; } };

export function relayConfig() {
  const endpoint = process.env.RELAY_ENDPOINT || readFile('.relay-endpoint');
  const secret = process.env.RELAY_SECRET || readFile('.relay-secret');
  return endpoint && secret ? { endpoint, secret } : null;
}

export async function relayFetch(url, config = relayConfig(), { fetchImpl = globalThis.fetch, timeoutMs = 30000 } = {}) {
  if (!config) return { status:'relay_disabled' };
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
