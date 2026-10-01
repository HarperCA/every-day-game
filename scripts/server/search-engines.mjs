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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX_RESULTS = 10;
const DISABLE_AFTER_FAILURES = 2; // 同一个引擎连续失败这么多次，本轮不再用它（避免额度用完后每个赛事组都白撞一次）

const readKey = file => { try { return fs.readFileSync(path.join(HERE, file), 'utf8').trim().replace(/^[A-Z_]+=/, ''); } catch { return ''; } };
const clipText = (value, n) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, n);
const normalize = item => ({ title:clipText(item?.title, 200), url:String(item?.url || ''), content:clipText(item?.content || item?.snippet, 600), date:clipText(item?.date || item?.publishedAt, 20) });
const withTimeout = ms => AbortSignal.timeout(ms);

// ---- 百度千帆 AI 搜索 ----
export function baiduEngine({ key = readKey('.baidu-search-key'), fetchImpl = globalThis.fetch } = {}) {
  return {
    name:'baidu', label:'百度', key,
    async search(query) {
      const request = () => fetchImpl('https://qianfan.baidubce.com/v2/ai_search/web_search', {
        method:'POST', headers:{ 'X-Appbuilder-Authorization':`Bearer ${key}`, 'Content-Type':'application/json' },
        body:JSON.stringify({ messages:[{ content:query, role:'user' }], search_source:'baidu_search_v2', resource_type_filter:[{ type:'web', top_k:MAX_RESULTS }] }),
        signal:withTimeout(20000),
      });
      let response;
      try { response = await request(); } catch { await new Promise(resolve => setTimeout(resolve, 500)); response = await request(); }
      if (!response.ok) throw new Error(`http_${response.status}`);
      const payload = await response.json();
      return { references:(payload.references || []).map(normalize).filter(item => item.url).slice(0, MAX_RESULTS) };
    },
  };
}

// ---- Kimi 会员通道的搜索（kimi-cli 的 SearchWeb 用的同一个接口，官方配置文档里有） ----
export function kimiEngine({ key = readKey('.ai-key'), fetchImpl = globalThis.fetch } = {}) {
  return {
    name:'kimi', label:'Kimi', key,
    async search(query) {
      const response = await fetchImpl('https://api.kimi.com/coding/v1/search', {
        method:'POST', headers:{ 'content-type':'application/json', authorization:`Bearer ${key}`, 'X-Msh-Tool-Call-Id':crypto.randomUUID() },
        body:JSON.stringify({ text_query:query, limit:MAX_RESULTS, enable_page_crawling:false, timeout_seconds:30 }),
        signal:withTimeout(40000),
      });
      if (!response.ok) throw new Error(`http_${response.status}`);
      const payload = await response.json();
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
      if (!response.ok) throw new Error(`http_${response.status}`);
      const payload = await response.json();
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

// 依次补位的搜索器。engines：[{ engine, budget }]，按优先级排好。
//   search(query)：用第一个“还有额度、没被停用”的引擎；它失败就记一笔、换下一个；全都用不了返回 null。
//   额度只在成功时扣；一个引擎连续失败 DISABLE_AFTER_FAILURES 次，本轮不再用它。
export function createSearcher(engines) {
  const state = engines.map(({ engine, budget }) => ({ engine, left:Math.max(0, budget), failures:0, used:0, disabled:!engine.key }));
  return {
    async search(query) {
      const attempts = [];
      for (const slot of state) {
        if (slot.disabled || slot.left <= 0) continue;
        const startedAt = Date.now();
        try {
          const result = await slot.engine.search(query);
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
