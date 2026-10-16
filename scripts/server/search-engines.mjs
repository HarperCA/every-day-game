// 通知追溯用的搜索引擎：百度 → Kimi → DeepSeek 依次补位（2026-10-01，用户定）。
//
// 为什么有三个：通知追溯每晚要搜的上级赛事（提得出合法赛事名的）常常多于百度分给它的 10 次额度。
// 优先用百度（月度免费额度、返回摘要和日期、官网排名最好）；百度的额度用完，改用 Kimi 会员通道自带的搜索；
// 还不够，最后用 DeepSeek 的联网搜索（按 token 计费，没有次数上限，但只返回标题和网址，没有摘要和日期）。
//
// 三个引擎对外是同一个形状：search(query) → { references:[{ title, url, content, date }], usage? }。
// 每次搜索都会留下“用了哪个、返回了什么”的记录（见 searchChain 返回的 attempts），后台“查看明细”据此显示。
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_HOSTS, loadBlockedSites } from './site-blocklist.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX_RESULTS = 10;
const DISABLE_AFTER_FAILURES = 2; // 同一个引擎连续失败这么多次，本轮不再用它（避免额度用完后每个赛事组都白撞一次）

// 保存搜索接口的原始返回（2026-10-03，用户要求：保存一次原始数据，用来测试流程）。
// 设了环境变量 SEARCH_RAW_FILE 才保存：每次调用追加一行 JSON（引擎、查询词、HTTP 状态、接口原样返回的正文）。
// 平时不设，不保存；由流水线按 plans/save-raw-once 标记打开（见 run-crawl-pipeline.mjs）。
export function recordRawSearch(engine, query, status, body) {
  const file = process.env.SEARCH_RAW_FILE;
  if (!file) return;
  try { fs.appendFileSync(file, `${JSON.stringify({ at:new Date().toISOString(), engine, query, status, body })}\n`, 'utf8'); } catch { /* 保存失败不影响搜索 */ }
}

// 百度每天的总用量（2026-10-10 用户定）：自动任务每天最多 30 次，剩下的留给手动测试。
// 百度的调用分散在几个程序里（夜间搜索、通知追溯代理、补读正式通知、记录追溯），各自只管自己的份额，
// 合起来会超；这里用一个共享的计数文件按北京时间的日期记总数，每次调用前先领一次，领不到就不调。
// 手动测试时设环境变量 BAIDU_MANUAL=1：单独记在 manual 里，不受 30 次限制，也不占自动任务的份额。
export const BAIDU_DAILY_AUTO_LIMIT = 30;
const BAIDU_USAGE_FILE = path.join(HERE, 'state', 'baidu-usage.json');
const beijingDate = now => new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
export function takeBaiduQuota({ caller = '', now = new Date(), file = process.env.BAIDU_USAGE_FILE || BAIDU_USAGE_FILE,
  limit = Number(process.env.BAIDU_DAILY_LIMIT) || BAIDU_DAILY_AUTO_LIMIT, manual = process.env.BAIDU_MANUAL === '1' } = {}) {
  const date = beijingDate(now);
  let usage = {};
  try { usage = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* 第一次或文件坏了，从 0 记 */ }
  if (usage.date !== date) usage = { date, auto:0, manual:0, byCaller:{} };
  if (!manual && usage.auto >= limit) return { ok:false, used:usage.auto, limit };
  usage[manual ? 'manual' : 'auto'] += 1;
  if (caller) usage.byCaller[caller] = (usage.byCaller[caller] || 0) + 1;
  fs.mkdirSync(path.dirname(file), { recursive:true });
  fs.writeFileSync(file, JSON.stringify(usage, null, 2), 'utf8');
  return { ok:true, used:usage.auto, limit };
}
// 领不到时抛出的错误带 http_429 字样，各处原有的“额度用完”处理照常生效
export function requireBaiduQuota(caller) {
  const quota = takeBaiduQuota({ caller });
  if (!quota.ok) throw new Error(`http_429: baidu_daily_auto_limit 今日自动任务已用 ${quota.used}/${quota.limit} 次百度搜索，剩下的留给测试`);
}

const readKey = file => { try { return fs.readFileSync(path.join(HERE, file), 'utf8').trim().replace(/^[A-Z_]+=/, ''); } catch { return ''; } };
const clipText = (value, n) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, n);
const normalize = item => ({ title:clipText(item?.title, 200), url:String(item?.url || ''), content:clipText(item?.content || item?.snippet, 600), date:clipText(item?.date || item?.publishedAt, 20) });
const withTimeout = ms => AbortSignal.timeout(ms);

// ---- 百度千帆 AI 搜索 ----
// 通知追溯、补读正式通知用的百度搜索（2026-10-09 起）：屏蔽转载、问答、聚合站和微信公众号文章（含子站），
// 它们不是主办方原文，公众号文章追溯时也读不了，搜出来只会白占结果位置。学校网站不屏蔽：不少赛事官网挂在 edu.cn 下。
// 官方参数说明：https://cloud.baidu.com/doc/qianfan-api/s/Wmbq4z7e5
// 2026-10-12 起和夜间搜索共用一份名单（site-blocklist.mjs：内置 + 后台确认），微信公众号已在内置名单里
export const TRACE_BLOCKED_WEBSITES = BUILTIN_HOSTS;
// 百度可选的搜索范围（2026-10-10 用户要求，给通知追溯代理用；官方文档 https://cloud.baidu.com/doc/qianfan-api/s/Wmbq4z7e5）：
//   site：只在这个网站里搜（search_filter.match.site，填不带协议的域名；官方注明为限时免费的付费功能）
//   recent：只要近期发布的网页（search_recency_filter：week 7 天、month 30 天、semiyear 180 天、year 365 天）
export const BAIDU_RECENCY = ['week', 'month', 'semiyear', 'year'];
export function normalizeSite(value) {
  const host = String(value || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : '';
}
export function baiduSearchBody(query, { site = '', recent = '', blocked = TRACE_BLOCKED_WEBSITES } = {}) {
  const host = normalizeSite(site);
  return { messages:[{ content:query, role:'user' }], search_source:'baidu_search_v2', resource_type_filter:[{ type:'web', top_k:MAX_RESULTS }],
    block_websites:blocked, query_policy:{ enable_rewrite:true },
    ...(host ? { search_filter:{ match:{ site:[host] } } } : {}), ...(BAIDU_RECENCY.includes(recent) ? { search_recency_filter:recent } : {}) };
}
// blocked：屏蔽名单，不给就读 site-blocklist.mjs 的（内置 + 后台确认）
export function baiduEngine({ key = readKey('.baidu-search-key'), fetchImpl = globalThis.fetch, caller = 'trace', blocked = null } = {}) {
  return {
    name:'baidu', label:'百度', key,
    async search(query, options = {}) {
      requireBaiduQuota(caller);
      const sites = blocked || await loadBlockedSites();
      const request = () => fetchImpl('https://qianfan.baidubce.com/v2/ai_search/web_search', {
        method:'POST', headers:{ 'X-Appbuilder-Authorization':`Bearer ${key}`, 'Content-Type':'application/json' },
        body:JSON.stringify(baiduSearchBody(query, { ...options, blocked:sites })),
        signal:withTimeout(20000),
      });
      let response;
      try { response = await request(); } catch { await new Promise(resolve => setTimeout(resolve, 500)); response = await request(); }
      const raw = await response.text();
      recordRawSearch('baidu', query, response.status, raw);
      if (!response.ok) throw new Error(`http_${response.status}`);
      const payload = JSON.parse(raw);
      return { references:(payload.references || []).map(normalize).filter(item => item.url).slice(0, MAX_RESULTS) };
    },
  };
}

// ---- Kimi 会员通道的搜索（kimi-cli 的 SearchWeb 用的同一个接口，官方配置文档里有） ----
// 服务端错误（5xx）等 retryDelayMs 后重试一次（2026-10-12）。
// 带 site: 的搜索在那个网站里没有结果时，接口不返回空列表，而是报 500（2026-10-11 实测：同一查询连搜两次都是 500，
// 换成不存在的网站也是 500；不带 site: 的搜索没结果时正常返回 200）。重试后仍是 500 的 site: 搜索按“没有结果”返回，
// 不算引擎故障——否则搜索器连续两次失败就整晚停用 Kimi 搜索（10/11、10/12 两晚开跑几分钟就被停掉），
// 处置代理也会因为一次搜索失败整条记录判失败。不带 site: 的 500 仍按失败处理。
export function kimiEngine({ key = readKey('.ai-key'), fetchImpl = globalThis.fetch, retryDelayMs = 2000 } = {}) {
  return {
    name:'kimi', label:'Kimi', key,
    async search(query) {
      const request = async () => {
        const response = await fetchImpl('https://api.kimi.com/coding/v1/search', {
          method:'POST', headers:{ 'content-type':'application/json', authorization:`Bearer ${key}`, 'X-Msh-Tool-Call-Id':crypto.randomUUID() },
          body:JSON.stringify({ text_query:query, limit:MAX_RESULTS, enable_page_crawling:false, timeout_seconds:30 }),
          signal:withTimeout(40000),
        });
        const raw = await response.text();
        recordRawSearch('kimi', query, response.status, raw);
        return { response, raw };
      };
      let { response, raw } = await request();
      if (response.status >= 500) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        ({ response, raw } = await request());
      }
      if (response.status === 500 && /(^|\s)site:\S/i.test(query)) return { references:[] };
      if (!response.ok) throw new Error(`http_${response.status}`);
      const payload = JSON.parse(raw);
      // 接口不一定遵守 limit（实测 limit=10 返回过 14 条），自己截断
      return { references:(payload.search_results || []).map(normalize).filter(item => item.url).slice(0, MAX_RESULTS) };
    },
  };
}

// ---- DeepSeek 联网搜索（Anthropic 兼容接口里的 web_search 工具，服务端执行） ----
// 只返回标题和网址（摘要是加密的，读不了），也没有日期；用模型一次，只让它原样搜一次。
export function deepseekEngine({ key = readKey('.extract-key'), fetchImpl = globalThis.fetch, model = 'deepseek-flash' } = {}) {
  return {
    name:'deepseek', label:'DeepSeek', key,
    async search(query) {
      const response = await fetchImpl('https://api.deepseek.com/anthropic/v1/messages', {
        method:'POST', headers:{ 'x-api-key':key, 'anthropic-version':'2023-06-01', 'content-type':'application/json' },
        body:JSON.stringify({ model, max_tokens:1500, tools:[{ type:'web_search_20250305', name:'web_search', max_uses:1 }],
          messages:[{ role:'user', content:`请只调用一次联网搜索工具，搜索词必须原样使用：${query}（不要改写）。搜索完不用总结，回复“完成”即可。` }] }),
        signal:withTimeout(90000),
      });
      const raw = await response.text();
      recordRawSearch('deepseek', query, response.status, raw);
      if (!response.ok) throw new Error(`http_${response.status}`);
      const payload = JSON.parse(raw);
      if (payload.error) throw new Error(String(payload.error.message || payload.error.type || 'deepseek_error').slice(0, 120));
      const blocks = (payload.content || []).filter(block => block.type === 'web_search_tool_result');
      const failed = blocks.find(block => !Array.isArray(block.content));
      const items = blocks.flatMap(block => (Array.isArray(block.content) ? block.content : []));
      if (!items.length && failed) throw new Error(`search_error:${String(failed.content?.error_code || 'unknown').slice(0, 60)}`);
      const usage = payload.usage ? { inputTokens:payload.usage.input_tokens, outputTokens:payload.usage.output_tokens } : undefined;
      return { references:items.map(normalize).filter(item => item.url).slice(0, MAX_RESULTS), usage };
    },
  };
}

// ---- Kimi 会员通道的读网页接口（kimi-cli 的 FetchURL 用的同一个接口） ----
// 在服务端执行页面脚本后返回正文（markdown）。用来重读“空壳页”：很多赛事官网是前后端分离的，
// 直接下载只拿到 30～600 字的导航骨架，内容要靠浏览器运行脚本才加载（2026-10-01 重跑：32 条读详情里 12 条如此）。
// 只在我们自己的抓取已经确认 robots 允许、拿到了骨架之后才调用（robots 不允许的站，如微信，不会走到这里）。
export async function kimiFetchPage(url, { key = readKey('.ai-key'), fetchImpl = globalThis.fetch, timeoutMs = 60000 } = {}) {
  if (!key) throw new Error('kimi_key_not_configured');
  const startedAt = Date.now();
  const response = await fetchImpl('https://api.kimi.com/coding/v1/fetch', {
    method:'POST', headers:{ 'content-type':'application/json', authorization:`Bearer ${key}`, 'X-Msh-Tool-Call-Id':crypto.randomUUID() },
    body:JSON.stringify({ url }), signal:withTimeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`http_${response.status}`);
  const payload = await response.json();
  const raw = String(payload?.markdown || payload?.content || '');
  // 页面里的图片（Kimi 转存到它自己的图床）：正文里去掉，地址留给“识别页面图片”用（page-supplement.mjs）
  const images = [...new Set([...raw.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map(match => match[1]))];
  const markdown = raw
    // 页面里的图片换成占位，不占正文篇幅（图片地址是 Kimi 的图床，不是原站）
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { markdown, images, ms:Date.now() - startedAt };
}

// 依次补位的搜索器。engines：[{ engine, budget }]，按优先级排好。
//   search(query)：用第一个“还有额度、没被停用”的引擎；它失败就记一笔、换下一个；全都用不了返回 null。
//   额度只在成功时扣；一个引擎连续失败 DISABLE_AFTER_FAILURES 次，本轮不再用它。
export function createSearcher(engines) {
  const state = engines.map(({ engine, budget }) => ({ engine, left:Math.max(0, budget), failures:0, used:0, disabled:!engine.key }));
  return {
    // options（site、recent）只有百度认；换到其他引擎时照常只按搜索词搜
    async search(query, options = {}) {
      const attempts = [];
      for (const slot of state) {
        if (slot.disabled || slot.left <= 0) continue;
        const startedAt = Date.now();
        try {
          const result = await slot.engine.search(query, options);
          slot.left -= 1; slot.used += 1; slot.failures = 0;
          attempts.push({ engine:slot.engine.name, label:slot.engine.label, ok:true, returned:result.references.length, ms:Date.now() - startedAt, ...(result.usage ? { usage:result.usage } : {}) });
          return { engine:slot.engine.name, label:slot.engine.label, references:result.references, attempts };
        } catch (error) {
          slot.failures += 1;
          if (slot.failures >= DISABLE_AFTER_FAILURES) slot.disabled = true;
          attempts.push({ engine:slot.engine.name, label:slot.engine.label, ok:false, error:String(error?.message || error).slice(0, 160), ms:Date.now() - startedAt });
        }
      }
      return attempts.length ? { engine:'', label:'', references:[], attempts, failed:true } : null;
    },
    // 本轮各引擎用了多少、还剩多少、有没有被停用
    summary: () => state.map(slot => ({ engine:slot.engine.name, label:slot.engine.label, used:slot.used, left:slot.left, disabled:slot.disabled, configured:Boolean(slot.engine.key) })),
  };
}
