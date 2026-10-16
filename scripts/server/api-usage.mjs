// 接口用量记账（2026-10-10 起，后台“接口用量”页的数据来源）。
//
// 做法：每个后台进程启动时用 node --import 加载 api-usage-hook.mjs（systemd 里设 NODE_OPTIONS），
// 把全局 fetch 包一层：凡是打到下面这些付费或有额度的接口的请求，都记一行——
// 哪个接口、哪个程序调的、成功没有、HTTP 状态、耗时、token、费用、错误码。不改任何调用处，以后新加的调用自动算进去。
//
// 记在 state/api-usage/<北京日期>.jsonl，每次调用追加一行（多个进程同时追加也不会互相覆盖）。
// “哪个程序调的”：脚本按脚本名（notice-agent、run-extract……）；后台服务按“函数.操作”（adminData.runScheduledAiReview）；
// 代码里可用 globalThis.__apiUsage.run('处置代理', fn) 在当前位置下再细分一层。
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DIR = path.join(HERE, 'state', 'api-usage');
const KEEP_DAYS = 120;

// 按网址认接口：只记这些，其他网络请求（抓网页、读官网）一律不记
export function classifyApi(url) {
  let parsed;
  try { parsed = new URL(String(url)); } catch { return null; }
  const host = parsed.hostname;
  const p = parsed.pathname;
  if (host === 'qianfan.baidubce.com' && p.includes('/ai_search')) return 'baidu_search';
  if (host === 'api.kimi.com') return /\/search$/.test(p) ? 'kimi_search' : /\/fetch$/.test(p) ? 'kimi_fetch' : 'kimi_chat';
  if (host === 'api.moonshot.cn' || host === 'api.moonshot.ai') return 'kimi_chat';
  if (host === 'api.deepseek.com') return 'deepseek';
  if (host === 'openrouter.ai') return 'openrouter';
  if (host === 'api.weixin.qq.com') return 'wechat';
  return null;
}

// 从返回正文里取 token 和费用。流式返回（SSE）取最后一次出现的 usage
export function parseUsage(text) {
  const raw = String(text || '');
  const last = name => { const all = [...raw.matchAll(new RegExp(`"${name}"\\s*:\\s*(\\d+(?:\\.\\d+)?)`, 'g'))]; return all.length ? Number(all[all.length - 1][1]) : null; };
  const tokensIn = last('prompt_tokens') ?? last('input_tokens');
  const tokensOut = last('completion_tokens') ?? last('output_tokens');
  const total = last('total_tokens') ?? (tokensIn !== null || tokensOut !== null ? (tokensIn || 0) + (tokensOut || 0) : null);
  const cost = last('cost');
  return { tokensIn, tokensOut, tokens:total, costUsd:cost };
}

// 错误码：百度 {"code":"QUOTA_USER_DAILY_FREE"}、微信 {"errcode":40001}、其余取 HTTP 状态
export function errorCode(status, text) {
  const raw = String(text || '');
  const code = raw.match(/"code"\s*:\s*"([A-Z_]{3,})"/)?.[1] || raw.match(/"type"\s*:\s*"([a-z_]{3,})"/)?.[1];
  const wx = raw.match(/"errcode"\s*:\s*(-?\d+)/)?.[1];
  if (wx && wx !== '0') return `errcode_${wx}`;
  return code || (status ? `http_${status}` : 'network_error');
}

const beijingDate = now => new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);

export function createRecorder({ dir = process.env.API_USAGE_DIR || DEFAULT_DIR, defaultCaller = '', now = () => new Date() } = {}) {
  const storage = new AsyncLocalStorage();
  let pruned = false;
  const caller = () => storage.getStore()?.label || process.env.API_USAGE_CALLER || defaultCaller || 'unknown';
  function write(entry) {
    try {
      const at = now();
      fs.mkdirSync(dir, { recursive:true });
      fs.appendFileSync(path.join(dir, `${beijingDate(at)}.jsonl`), `${JSON.stringify({ at:at.toISOString(), ...entry })}\n`, 'utf8');
      if (!pruned) {
        pruned = true;
        const oldest = beijingDate(new Date(at.getTime() - KEEP_DAYS * 86400000));
        for (const name of fs.readdirSync(dir)) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name) && name.slice(0, 10) < oldest) fs.rmSync(path.join(dir, name), { force:true });
      }
    } catch { /* 记账失败不影响业务调用 */ }
  }
  function wrap(originalFetch) {
    return async function fetchWithUsage(input, init) {
      const url = typeof input === 'string' ? input : input?.url || String(input);
      const api = classifyApi(url);
      if (!api) return originalFetch(input, init);
      const started = Date.now();
      const base = { api, endpoint:new URL(url).pathname.slice(0, 80), caller:caller() };
      let response;
      try { response = await originalFetch(input, init); }
      catch (error) {
        write({ ...base, ok:false, status:0, ms:Date.now() - started, error:/abort|timeout/i.test(String(error?.name || error?.message)) ? 'timeout' : 'network_error' });
        throw error;
      }
      let copy = null;
      try { copy = response.clone(); } catch { /* 克隆不了就只记状态 */ }
      const finish = text => {
        const usage = parseUsage(text);
        const wxFail = api === 'wechat' && /"errcode"\s*:\s*[1-9-]/.test(String(text || ''));
        const ok = response.ok && !wxFail;
        write({ ...base, ok, status:response.status, ms:Date.now() - started,
          ...(usage.tokens !== null ? { tokens:usage.tokens, tokensIn:usage.tokensIn, tokensOut:usage.tokensOut } : {}),
          ...(usage.costUsd !== null ? { costUsd:usage.costUsd } : {}), ...(ok ? {} : { error:errorCode(response.status, text) }) });
      };
      if (copy) copy.text().then(finish, () => finish('')); else finish('');
      return response;
    };
  }
  return {
    // 在当前位置下再细分一层：run('处置代理', fn) → “adminData.runScheduledAiReview › 处置代理”
    run(label, fn) {
      const parent = storage.getStore()?.label;
      return storage.run({ label:parent && !label.startsWith(parent) ? `${parent} › ${label}` : label }, fn);
    },
    current:caller,
    wrap,
    write,
  };
}

export function install() {
  if (globalThis.__apiUsage || typeof globalThis.fetch !== 'function') return globalThis.__apiUsage;
  const script = path.basename(process.argv[1] || '', path.extname(process.argv[1] || ''));
  const recorder = createRecorder({ defaultCaller:script === 'index' ? 'api-server' : script });
  globalThis.fetch = recorder.wrap(globalThis.fetch.bind(globalThis));
  globalThis.__apiUsage = recorder;
  return recorder;
}
