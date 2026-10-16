// 通知追溯（2026-10-13 起默认 Codex CLI）：代理决定搜索与读取动作，程序执行并核对证据。
// 直到找出这场比赛自己的官方来源，或者说明为什么不是比赛、为什么找不到。取代原来一次性的 resolve-notice-leads.mjs。
//
// 搜索：先用百度，用的是原来通知追溯那份额度（搜索计划 trace.noticeFollowups，默认每晚 10 次）；用完换 Kimi 自己的搜索。
// 读网页：Kimi 会员通道的读网页接口（脚本渲染的页面、PDF 都能读）。
// 用量：每晚 token 上限（流水线传 150 万），同时处理 4 篇，每篇最多 6 轮、6 万 token；Kimi 额度用完就停，剩下的不记“已处理”，第二天再来。
// 2026-10-12 起只处理固定步骤（notice-resolver.mjs）没核到的通知，并且：
//   · 读网页不再给模型全文，改为“提取 + 核对”：DeepSeek-Flash 摘出要点和原文，代码逐字核对（source-check.mjs），模型只看到几行要点和页面链接；
//   · 已核到官方来源和关键字段，或这一篇用量到上限，代码让它直接收尾；
//   · 结论里的来源由代码复核（finalizeSources）：没读到正文的、转载或自媒体网站的、摘录对不上原文的都去掉，一个不剩就改为“找不到”；
//   · 不读搜索引擎结果页和转读、存档服务；固定步骤试过的搜索词和网页通过 traceHint 告诉代理，不重复。
// 输出：沿用 notice-resolution-leads.json 的格式（results[].leads），后面的判重、读详情、入库和后台运行明细不用改。
//   代理找到的官方网址记成 fromNoticeText，前置筛选不再让 Jev 复判，只按网址判重。
// 用法：node notice-agent.mjs <通知文件> <输出文件> [--baidu-budget 10] [--kimi-search-budget 300]
//        [--budget-tokens 6000000] [--concurrency 4] [--max-turns 10]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baiduEngine, createSearcher, kimiEngine, kimiFetchPage } from './search-engines.mjs';
import { BUILTIN_HOSTS, isBlockedHost, loadBlockedSites } from './site-blocklist.mjs';
import { REPOST_HOSTS, checkVerification, quoteFound, verifyOfficialSource } from './source-check.mjs';
import { defaultPageReader } from './page-reader.mjs';
import { codexChat, CODEX_MODEL, CODEX_REASONING_EFFORT } from './codex-agent.mjs';
import { createBeijingReader } from './beijing-page-reader.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODEL = process.env.AI_MODEL || 'kimi-for-coding';
const BASE_URL = process.env.AGENT_BASE_URL || 'https://api.kimi.com/coding/v1';

// 代理有明确结论的才算追溯完成（记 30 天不重复）；没轮上、出错的第二天再来
export const CONCLUSIVE = new Set(['found_official', 'not_competition', 'sub_track', 'not_found', 'unreadable']);
const OUTCOME_LABEL = { found_official:'找到官方来源', not_competition:'不是值得收录的比赛', sub_track:'只是赛区或校内选拔，追不到上级赛事官方来源',
  not_found:'是比赛，但找不到官方来源', unreadable:'找到官网但读不出内容', skipped_budget:'没轮上（本晚 token 上限或代理额度用完）',
  error:'代理出错', bad_output:'代理没给出有效结论' };
export const outcomeLabel = outcome => OUTCOME_LABEL[outcome] || outcome || '';

const isQuotaError = text => /usage limit|quota|模型调用失败 (?:402|403)\b/i.test(String(text || ''));

function systemPrompt(today, maxTurns, provider = 'kimi') {
  return `你是“每日竞赛”小程序的赛事核对员。小程序收录面向在校大学生/研究生的各类学科竞赛。今天是 ${today}。
你拿到的是夜间抓取到的一篇通知或新闻的标题和摘要（多半是学校转发的校内选拔通知、赛果新闻）。你的任务：
1. 判断它背后是不是一场值得收录的比赛。不是比赛的（奖学金/助学金评选、招聘、招生、教师赛、职工技能竞赛、纯学术会议、只面向企业人员的赛事、单校内部比赛）直接结论“不是比赛”。
2. 是比赛的：找出这场比赛自己的**官方来源**——主办方/组委会/主管部门（教育部、教育厅、行业学会、协会）的官网或正式通知。学校转发、新闻、公众号、竞赛聚合站（52jingsai、saikr 等）只能当线索，不能当来源。
   - 如果通知是某全国大赛的省赛区、校内选拔赛，要追到上级全国赛事，以上级赛事为准；上级赛事的官网才是来源。
   - 官网读到旧一届时，去找最新一届；读到空壳页面（只有几十字）就换办法：搜它的通知、找学会/协会网站上的公告、读附件 PDF。
3. 找到官方来源后读正文，核对字段：主办单位、参赛对象（必须写明大学生/本科/研究生/高职等，照原文）、报名起止、比赛时间、报名入口、费用、奖项。
   原则：没核到的不写。每个字段都必须在官方来源原文里找到，找不到就留空，绝不推断、不编造日期和网址。
${provider === 'deepseek' ? '工具：web_search（联网搜索，由系统执行，结果你能直接看到；搜索结果只能当线索，结论必须用 fetch_page 读过的网页核对）' : '工具：web_search(query, site?, recent?)（返回标题、网址、摘要。site 填域名就只在这个网站里搜，例如找到官网 culsc.cn 后用 site 搜它的最新通知；recent 只要近期网页：week/month/semiyear/year，找最新一届时可用。这两个参数只在百度搜索时生效）'}、fetch_page(url)（读网页或 PDF，返回的是核对过的要点：是不是官方来源，主办、参赛对象、届次、报名时间各自的原文，以及页面里的通知和附件链接，不是全文）。
最多使用 ${maxTurns - 1} 轮工具，要节约：第一轮可以同时发 2～3 个不同角度的搜索（例如官网、当届通知、主办方）。不要读百度、必应、谷歌等搜索引擎的结果页，也不要用转读、存档服务，搜索请用 web_search。
sources 只能填你用 fetch_page 读过、而且核对结论是官方来源的网址；evidence 原样复制核对结果里的原文（带引号）。
最后只回复一个 JSON 对象，不要有其他文字：
{"outcome":"found_official|not_competition|sub_track|not_found|unreadable",
 "reason":"一句话说明结论的理由",
 "contest_name":"赛事名（不含年份、届次；不是比赛时留空）",
 "level":"国家级|省级/区域级|国际级|其他/未明确",
 "edition_year":"","edition_ordinal":"",
 "organizer":"","participants":"","format":"",
 "registration_url":"","registration_start":"YYYY-MM-DD或空","registration_end":"YYYY-MM-DD或空",
 "competition_start":"YYYY-MM-DD或空","competition_end":"YYYY-MM-DD或空",
 "time_note":"","status":"open|closed|pending","fee":"","rewards":"",
 "sources":[{"url":"","type":"organizer_website|organizer_notice|official_registration_system","evidence":"原文摘录，证明主办方、对象、时间"}],
 "unverified":["没核到、留空的字段"],"confidence":0到1}
outcome 含义：found_official=找到官方来源并核对字段（通知只是赛区或校内选拔的，追到上级赛事并找到上级赛事的官方来源，也算 found_official，字段按上级赛事填写，contest_name 写上级赛事名）；not_competition=不是值得收录的比赛；sub_track=只是赛区或校内选拔，而且追不到上级赛事的官方来源（reason 里写上级赛事名）；not_found=是比赛但找不到官方来源；unreadable=找到官网但读不出内容。`;
}

// DeepSeek 代理的工具：联网搜索由 DeepSeek 服务端执行；读网页是我们自己的（Anthropic 兼容接口的格式）
const DS_TOOLS = [
  { type:'web_search_20250305', name:'web_search', max_uses:4 },
  { name:'fetch_page', description:'读取网页或 PDF，返回核对过的要点（是不是官方来源，主办、参赛对象、届次、报名时间的原文）和页面里的通知、附件链接', input_schema:{ type:'object', properties:{ url:{ type:'string' } }, required:['url'] } },
];

const TOOLS = [
  { type:'function', function:{ name:'web_search', description:'联网搜索，返回最多 8 条结果（标题、网址、摘要）', parameters:{ type:'object', properties:{
    query:{ type:'string' },
    site:{ type:'string', description:'可选：只在这个网站里搜，填域名（不带 http），例如 culsc.cn' },
    recent:{ type:'string', enum:['week', 'month', 'semiyear', 'year'], description:'可选：只要最近 7 天 / 30 天 / 180 天 / 365 天发布的网页' },
  }, required:['query'] } } },
  { type:'function', function:{ name:'fetch_page', description:'读取网页或 PDF 正文（脚本渲染的页面也能读），每次最多 6000 字', parameters:{ type:'object', properties:{ url:{ type:'string' }, start:{ type:'integer', description:'起始字符位置，默认 0' } }, required:['url'] } } },
];

function parseJson(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

// 代理结论 → notice-resolution-leads.json 的一条结果。
// 找到官方来源的：每个官方网址一条 lead（最多 2 个），标题用赛事名（官方通知标题常带“通知”二字，会被后面的标题过滤挡掉）。
// 有明确结论的写 followupQuery，流水线据此记 30 天不重复追溯；没轮上、出错的不写，第二天再来。
export function toLeadResult(notice, result) {
  const name = String(result.contest_name || '').trim();
  const found = result.outcome === 'found_official';
  const leads = found ? (result.sources || []).filter(source => /^https?:\/\//i.test(source.url || '')).slice(0, 2)
    .map(source => ({ url:source.url, title:name, summary:String(source.evidence || '').slice(0, 600), fromNoticeText:true, sourceType:source.type || '' })) : [];
  const queries = (result.trace || []).filter(step => step.tool === 'web_search').map(step => step.input);
  return {
    noticeUrl:notice.detailUrl, noticeTitle:notice.name, notices:[], proposedName:name,
    ...(notice.discovery ? { noticeDiscovery:notice.discovery } : {}),
    ...(CONCLUSIVE.has(result.outcome) ? { followupQuery:queries[0] || `${result.provider === 'codex' ? 'Codex' : '赛事'}代理：${outcomeLabel(result.outcome)}` } : {}),
    leads,
    agent:{ provider:result.provider || '', outcome:result.outcome || 'bad_output', label:outcomeLabel(result.outcome), reason:String(result.reason || '').slice(0, 400),
      turns:result.turns || 0, tokens:result.tokens || 0, searches:queries.length,
      reads:(result.trace || []).filter(step => step.tool === 'fetch_page').length,
      engines:result.engines || {}, trace:(result.trace || []).slice(0, 40) },
    ...(['error', 'bad_output'].includes(result.outcome) ? { error:String(result.reason || '').slice(0, 200) } : {}),
  };
}

// 搜索引擎结果页、转读和存档服务：不读（2026-10-11 一晚 465 次读网页里 193 次是这些）
const SEARCH_PAGE = /^(https?:\/\/)?([a-z0-9-]+\.)*(baidu\.com\/s|bing\.com\/search|google\.[a-z.]+\/search|duckduckgo\.com|so\.com\/s|sogou\.com\/web|r\.jina\.ai|web\.archive\.org)/i;
const QUOTED = /[“"「『]([^”"」』]{8,})[”"」』]/g;
const FIELD_LABEL = { publisher:'发布单位', organizer:'主办', participants:'参赛对象', edition:'届次', registration_start:'报名开始', registration_end:'报名截止', registration_url:'报名入口' };

// 结论里的来源由代码复核（2026-10-12）：必须是这一篇真的读到过正文的网页，不能是转载或自媒体网站，
// 启用核验时必须核到官方来源；核验失败或缺失需重试，不能记成已追溯完成。
export function finalizeSources(result, { pages, checks, blocked = BUILTIN_HOSTS, requireVerification = false }) {
  const failedChecks = [...checks.values()].filter(check => check.decision === 'error');
  if (result.outcome !== 'found_official') return requireVerification && failedChecks.length
    ? { ...result, outcome:'error', sources:[], reason:`来源核验失败，需重试：${failedChecks.map(check => check.reason).join('；').slice(0, 200)}` } : result;
  const kept = [];
  const removed = [];
  let verificationFailed = false;
  for (const source of result.sources || []) {
    const url = String(source?.url || '');
    const page = pages.get(url);
    const check = checks.get(url);
    const quotes = [...String(source?.evidence || '').matchAll(QUOTED)].map(match => match[1]);
    const why = !page || page.status !== 'ok' || String(page.text || '').length < 200 ? '这个网址没读到正文'
      : isBlockedHost(url, [...blocked, ...REPOST_HOSTS]) || isBlockedHost(page.finalUrl || url, [...blocked, ...REPOST_HOSTS]) || SEARCH_PAGE.test(page.finalUrl || url) ? '转载、自媒体或屏蔽名单里的网站'
        : check?.decision === 'error' || (requireVerification && !check) ? '来源核验失败或缺失，需重试'
          : check && check.decision !== 'found' ? `来源核验未通过：${check.reason || check.decision}`
            : check?.decision === 'found' || (!requireVerification && quotes.some(quote => quoteFound(quote, page.text))) ? '' : '摘录不在原文里，核对也没通过';
    if (why === '来源核验失败或缺失，需重试') verificationFailed = true;
    if (why) removed.push({ url, why }); else kept.push(source);
  }
  if (!kept.length) return { ...result, outcome:verificationFailed || (requireVerification && failedChecks.length) ? 'error' : 'not_found', sources:[], removedSources:removed,
    reason:`来源未通过核对（${removed.map(item => `${item.url}：${item.why}`).join('；').slice(0, 200)}）；代理原结论：${String(result.reason || '').slice(0, 120)}` };
  return { ...result, sources:kept, ...(removed.length ? { removedSources:removed } : {}) };
}

// 读网页工具返回给代理的内容：核对过的要点 + 页面里的链接，不是全文（每页几百字，而不是最多 6000 字）
export function formatPageFacts(page, check) {
  const lines = [`（已读 ${page.finalUrl || page.url}：全文 ${String(page.text || '').length} 字${page.via === 'kimi_fetch' ? '，经 Kimi 读网页' : ''}${page.format ? `，${page.format}` : ''}）`];
  lines.push(`核对结论：${check.decision === 'found' ? '是这场比赛的官方来源，主办方和参赛对象或报名截止已在原文核到' : check.reason || '没核到'}`);
  const fields = Object.entries(check.fields || {}).map(([field, item]) => `${FIELD_LABEL[field] || field}：${item.value}（原文：“${item.quote}”）`);
  if (fields.length) lines.push(...fields);
  if (check.dropped?.length) lines.push(`原文对不上、已去掉：${check.dropped.map(field => FIELD_LABEL[field] || field).join('、')}`);
  const links = (page.links || []).slice(0, 10).map((link, i) => `${i + 1}. ${String(link.text).slice(0, 40)} → ${link.url}`);
  if (links.length) lines.push('页面里的通知或附件链接：', ...links);
  return lines.join('\n');
}

export async function runNoticeAgent(notices, { baiduBudget = 10, kimiSearchBudget = 300, tokenBudget = 6000000, concurrency = 4, maxTurns = 6, perNoticeTokens = 60000,
  key, provider = 'codex', dsModel = 'deepseek-flash', codexDecision = codexChat, searcher, fetchPage = kimiFetchPage, readPage = null, verifyPage = null, blocked = BUILTIN_HOSTS, fetchImpl = globalThis.fetch, log = console.log } = {}) {
  if (!['codex', 'kimi', 'deepseek'].includes(provider)) throw new Error(`不支持的通知代理：${provider}`);
  const search = searcher || createSearcher([{ engine:baiduEngine({ caller:'notice-agent' }), budget:baiduBudget }, { engine:kimiEngine(), budget:kimiSearchBudget }]);
  const system = systemPrompt(new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10), maxTurns, provider);
  const year = new Date(Date.now() + 8 * 3600000).getUTCFullYear();
  // readPage：page-reader.mjs（自己抓 + 空壳页用 Kimi 读，PDF、Word 都能读）；不给就只用 fetchPage 的正文
  const read = readPage || (async url => { const text = String((await fetchPage(url))?.markdown || ''); return { status:text.trim() ? 'ok' : 'too_short', url, finalUrl:url, text, links:[] }; });
  const pageCache = new Map();
  let spentTokens = 0;
  let verifyTokens = 0;
  let stopReason = tokenBudget <= 0 ? `本晚 token 上限 ${tokenBudget} 已用完` : '';

  // 响应一到就计费；并发中已经发出的调用仍会结算，但不会再启动下一轮或下一篇。
  function accountUsage(used) {
    const value = Number(used);
    spentTokens += Number.isFinite(value) && value > 0 ? value : 0;
    if (spentTokens >= tokenBudget && !stopReason) stopReason = `本晚 token 上限 ${tokenBudget} 已用完`;
  }

  function requireBudget() {
    if (stopReason) throw Object.assign(new Error(stopReason), { code:'NOTICE_BUDGET_EXHAUSTED' });
  }

  async function chat(messages, withTools) {
    requireBudget();
    if (provider === 'codex') {
      try {
        const result = await codexDecision(messages, TOOLS, withTools);
        accountUsage(result.used);
        return result;
      } catch (error) {
        // CLI 已产生用量但最终 JSON/工具无效时也必须结算，避免错误响应无限白耗额度。
        accountUsage(error.used);
        throw error;
      }
    }
    // Kimi 会员通道不接受 temperature；它会先做内部推理，max_tokens 要留够
    const body = { model:MODEL, messages, max_tokens:8000, ...(withTools ? { tools:TOOLS, tool_choice:'auto' } : {}) };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      requireBudget();
      const response = await fetchImpl(`${BASE_URL}/chat/completions`, { method:'POST', headers:{ authorization:`Bearer ${key}`, 'content-type':'application/json' }, body:JSON.stringify(body), signal:AbortSignal.timeout(150000) });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.choices?.[0]) { const used = Number(data.usage?.total_tokens) || 0; accountUsage(used); return { data, used }; }
      if (![429, 500, 502, 503, 504].includes(response.status)) throw new Error(`模型调用失败 ${response.status} ${JSON.stringify(data).slice(0, 200)}`);
      await new Promise(resolve => setTimeout(resolve, 3000 * (attempt + 1)));
    }
    throw new Error('模型调用多次失败');
  }

  async function toolSearch({ query, site, recent } = {}, engines) {
    const result = await search.search(String(query || '').slice(0, 72), { site, recent });
    if (result?.engine) engines[result.engine] = (engines[result.engine] || 0) + 1;
    // 2026-10-12：搜索器停用了某个引擎也会返回 null，不再一律说成“额度用完”
    if (!result?.references?.length) return result ? '（这次搜索没有结果，换个搜法）' : '（这次搜索失败，换个搜法；不要去读搜索引擎的结果页）';
    return result.references.slice(0, 8).map(r => `${String(r.title).slice(0, 60)} | ${r.url} | ${String(r.content || '').replace(/\s+/g, ' ').slice(0, 160)}`).join('\n');
  }

  async function toolFetch(url, start, ctx) {
    const target = String(url || '');
    if (!/^https?:\/\//i.test(target)) return '（只能读 http/https 网址）';
    if (SEARCH_PAGE.test(target)) return '（不读搜索引擎的结果页和转读、存档服务，请用 web_search 搜索）';
    try {
      let page = pageCache.get(target);
      if (!page) { page = await read(target); pageCache.set(target, page); if (page.finalUrl && page.finalUrl !== target) pageCache.set(page.finalUrl, page); }
      ctx.pages.set(target, page);
      if (page.finalUrl) ctx.pages.set(page.finalUrl, page);
      if (page.status !== 'ok' || !String(page.text || '').trim()) return `（读不到正文：${page.status}${page.error ? `，${String(page.error).slice(0, 80)}` : ''}）`;
      if (isBlockedHost(page.finalUrl || target, [...blocked, ...REPOST_HOSTS]) || SEARCH_PAGE.test(page.finalUrl || target)) return '（最终网址是转载、自媒体、屏蔽名单或搜索结果页，不作为官方来源）';
      if (verifyPage) {
        if (!ctx.checks.has(target)) {
          let check;
          try {
            const verified = await verifyPage(ctx.name, ctx.title, [page]);
            verifyTokens += verified.tokens || 0;
            ctx.verifyTokens += verified.tokens || 0;
            if (!['official', 'repost', 'other_contest', 'old_edition', 'not_competition', 'unclear'].includes(verified.result?.verdict)) throw new Error('核验返回了无效结论');
            check = checkVerification(verified.result, [page], { year, blocked });
          } catch (error) { check = { decision:'error', reason:`核对调用失败：${String(error?.message || error).slice(0, 80)}` }; }
          ctx.checks.set(target, check);
          if (page.finalUrl) ctx.checks.set(page.finalUrl, check);
        }
        const check = ctx.checks.get(target);
        return formatPageFacts(page, check);
      }
      const from = Number(start) || 0;
      return `（全文 ${page.text.length} 字，这是第 ${from} 起的内容）\n${page.text.slice(from, from + 6000)}`;
    } catch (error) { return `（读取失败：${String(error.message || error).slice(0, 120)}）`; }
  }

  const userMessage = notice => `通知标题：${notice.name}\n通知网址：${notice.detailUrl}\n摘要：${String(notice.introduction || '').replace(/\s+/g, ' ').slice(0, 500)}\n（发现这篇通知的搜索：${notice.matchedQuery || notice.discovery?.query || ''}）${notice.contestName ? `\n（认出的比赛：${notice.contestName}）` : ''}${notice.traceHint ? `\n${notice.traceHint}` : ''}`;
  const newContext = notice => ({ name:notice.contestName || `这条通知背后的比赛（通知：${String(notice.name || '').slice(0, 60)}）`, title:notice.name, pages:new Map(), checks:new Map(), verifyTokens:0 });

  // ---- 显式选择 DeepSeek 时：DeepSeek-Flash + 它自带的联网搜索，读网页用我们的 fetch_page ----
  // 搜索结果的内容只有模型看得到（对我们是加密的），所以只当线索；结论里的来源必须是 fetch_page 读过、代码核对过的（finalizeSources）。
  async function chatDeepSeek(systemText, messages, withTools) {
    const body = { model:dsModel, max_tokens:8000, system:systemText, messages, tools:DS_TOOLS, ...(withTools ? {} : { tool_choice:{ type:'none' } }) };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      requireBudget();
      const response = await fetchImpl('https://api.deepseek.com/anthropic/v1/messages', { method:'POST',
        headers:{ 'x-api-key':key, 'anthropic-version':'2023-06-01', 'content-type':'application/json' }, body:JSON.stringify(body), signal:AbortSignal.timeout(180000) });
      const data = await response.json().catch(() => ({}));
      if (response.ok && Array.isArray(data.content)) {
        const used = (Number(data.usage?.input_tokens) || 0) + (Number(data.usage?.cache_read_input_tokens) || 0) + (Number(data.usage?.output_tokens) || 0);
        accountUsage(used);
        return { data, used, searches:Number(data.usage?.server_tool_use?.web_search_requests) || 0 };
      }
      if (![429, 500, 502, 503, 504].includes(response.status)) throw new Error(`模型调用失败 ${response.status} ${JSON.stringify(data).slice(0, 200)}`);
      await new Promise(resolve => setTimeout(resolve, 3000 * (attempt + 1)));
    }
    throw new Error('模型调用多次失败');
  }

  // 最后一轮的提示接在最后一条用户消息里（接口要求用户和模型交替发言）
  function appendUserText(messages, text) {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === 'user') {
      lastMessage.content = typeof lastMessage.content === 'string' ? [{ type:'text', text:lastMessage.content }, { type:'text', text }] : [...lastMessage.content, { type:'text', text }];
    } else messages.push({ role:'user', content:text });
  }

  async function runOneDeepSeek(notice) {
    const systemText = system;
    const messages = [{ role:'user', content:userMessage(notice) }];
    const trace = [];
    const engines = {};
    const ctx = newContext(notice);
    let own = 0;
    let finish = '';
    for (let turn = 0; turn < maxTurns; turn += 1) {
      if (stopReason) return { outcome:'skipped_budget', reason:stopReason, trace, engines, turns:turn, tokens:own };
      const last = turn === maxTurns - 1 || Boolean(finish);
      if (last) appendUserText(messages, finish || '工具次数用完了。请现在只回复最终 JSON。');
      let response;
      try { response = await chatDeepSeek(systemText, messages, !last); } catch (error) {
        error.noticeTokens = own + (Number(error.used) || 0);
        error.noticeTurns = turn + 1;
        error.noticeTrace = trace;
        error.noticeEngines = engines;
        throw error;
      }
      const { data, used, searches } = response;
      own += used;
      if (searches) engines.deepseek = (engines.deepseek || 0) + searches;
      for (const block of data.content) if (block.type === 'server_tool_use') trace.push({ tool:'web_search', input:String(block.input?.query || '').slice(0, 300), outputChars:0 });
      messages.push({ role:'assistant', content:data.content });
      if (data.stop_reason === 'pause_turn') continue;
      const uses = data.content.filter(block => block.type === 'tool_use');
      if (!uses.length) {
        const text = data.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
        const result = parseJson(text);
        const done = result && CONCLUSIVE.has(result.outcome) ? finalizeSources(result, { pages:ctx.pages, checks:ctx.checks, blocked, requireVerification:Boolean(verifyPage) }) : { outcome:'bad_output', reason:text.slice(0, 200) };
        return { ...done, trace, engines, turns:turn + 1, tokens:own, verifyTokens:ctx.verifyTokens, ...(finish ? { stoppedEarly:finish } : {}) };
      }
      const results = [];
      if (stopReason) return { outcome:'skipped_budget', reason:stopReason, trace, engines, turns:turn + 1, tokens:own, verifyTokens:ctx.verifyTokens };
      for (const use of uses) {
        const output = use.name === 'fetch_page' ? await toolFetch(use.input?.url, use.input?.start, ctx) : '（没有这个工具）';
        trace.push({ tool:use.name, input:String(use.input?.url || '').slice(0, 300), outputChars:output.length });
        results.push({ type:'tool_result', tool_use_id:use.id, content:output });
      }
      messages.push({ role:'user', content:results });
      if ([...ctx.checks.values()].some(check => check.decision === 'found')) finish = '已核到官方来源和关键字段，请直接输出最终 JSON（sources 用核对结论是官方来源的那一页）。';
      else if (own >= perNoticeTokens) finish = `这一篇的用量已到上限（${perNoticeTokens} token），请根据已读到的内容现在只回复最终 JSON。`;
    }
    return { outcome:'bad_output', reason:'超过最大轮数', trace, engines, turns:maxTurns, tokens:own, verifyTokens:ctx.verifyTokens };
  }

  async function runOne(notice) {
    if (provider === 'deepseek') return runOneDeepSeek(notice);
    const messages = [{ role:'system', content:system }, { role:'user', content:userMessage(notice) }];
    const trace = [];
    const engines = {};
    const ctx = newContext(notice);
    let own = 0;
    let finish = '';
    for (let turn = 0; turn < maxTurns; turn += 1) {
      if (stopReason) return { outcome:'skipped_budget', reason:stopReason, trace, engines, turns:turn, tokens:own };
      const last = turn === maxTurns - 1 || Boolean(finish);
      if (last) messages.push({ role:'user', content:finish || '工具次数用完了。请现在只回复最终 JSON。' });
      let response;
      try { response = await chat(messages, !last); } catch (error) {
        error.noticeTokens = own + (Number(error.used) || 0);
        error.noticeTurns = turn + 1;
        error.noticeTrace = trace;
        error.noticeEngines = engines;
        throw error;
      }
      const { data, used } = response;
      own += used;
      const message = data.choices[0].message;
      messages.push({ role:'assistant', content:message.content || '', ...(message.reasoning_content ? { reasoning_content:message.reasoning_content } : {}), ...(message.tool_calls ? { tool_calls:message.tool_calls } : {}) });
      if (!message.tool_calls?.length) {
        const result = parseJson(message.content);
        const done = result && CONCLUSIVE.has(result.outcome) ? finalizeSources(result, { pages:ctx.pages, checks:ctx.checks, blocked, requireVerification:Boolean(verifyPage) }) : { outcome:'bad_output', reason:String(message.content || '').slice(0, 200) };
        return { ...done, trace, engines, turns:turn + 1, tokens:own, verifyTokens:ctx.verifyTokens, ...(finish ? { stoppedEarly:finish } : {}) };
      }
      if (stopReason) return { outcome:'skipped_budget', reason:stopReason, trace, engines, turns:turn + 1, tokens:own, verifyTokens:ctx.verifyTokens };
      for (const call of message.tool_calls) {
        let parsed = {};
        try { parsed = JSON.parse(call.function.arguments || '{}'); } catch { /* 空参数 */ }
        const output = call.function.name === 'web_search' ? await toolSearch(parsed, engines)
          : call.function.name === 'fetch_page' ? await toolFetch(parsed.url, parsed.start, ctx) : '（没有这个工具）';
        const scope = [parsed.site ? `site:${parsed.site}` : '', parsed.recent ? `recent:${parsed.recent}` : ''].filter(Boolean).join(' ');
        trace.push({ tool:call.function.name, input:String(parsed.query || parsed.url || '').slice(0, 300) + (scope ? `（${scope}）` : ''), outputChars:output.length });
        messages.push({ role:'tool', tool_call_id:call.id, content:output });
      }
      // 代码判断什么时候停（2026-10-12）：已核到官方来源和关键字段，或这一篇的用量到上限，下一轮不给工具、只要最终结论
      if ([...ctx.checks.values()].some(check => check.decision === 'found')) finish = '已核到官方来源和关键字段，请直接输出最终 JSON（sources 用核对结论是官方来源的那一页）。';
      else if (own >= perNoticeTokens) finish = `这一篇的用量已到上限（${perNoticeTokens} token），请根据已读到的内容现在只回复最终 JSON。`;
    }
    return { outcome:'bad_output', reason:'超过最大轮数', trace, engines, turns:maxTurns, tokens:own, verifyTokens:ctx.verifyTokens };
  }

  const results = new Array(notices.length);
  let index = 0;
  let finished = 0;
  async function worker() {
    while (index < notices.length) {
      const i = index++;
      const notice = notices[i];
      let result;
      if (stopReason) result = { outcome:'skipped_budget', reason:stopReason };
      else {
        try { result = await runOne(notice); } catch (error) {
          const message = String(error.message || error);
          if (isQuotaError(message) && !stopReason) stopReason = `${provider === 'codex' ? 'Codex ' : provider === 'deepseek' ? 'DeepSeek 余额不足或' : 'Kimi '}额度用完：${message.slice(0, 120)}`;
          const reportedTokens = Number(error.noticeTokens ?? error.used);
          const failedUsage = { tokens:Number.isFinite(reportedTokens) && reportedTokens > 0 ? reportedTokens : 0, turns:error.noticeTurns || 0,
            trace:error.noticeTrace || [], engines:error.noticeEngines || {} };
          result = isQuotaError(message) || error.code === 'NOTICE_BUDGET_EXHAUSTED' ? { outcome:'skipped_budget', reason:stopReason, ...failedUsage } : { outcome:'error', reason:message.slice(0, 200), ...failedUsage };
        }
      }
      results[i] = { ...toLeadResult(notice, { ...result, provider }), method:'agent', ...(result.removedSources ? { removedSources:result.removedSources } : {}) };
      finished += 1;
      log(`[${finished}/${notices.length}] ${outcomeLabel(result.outcome)}｜${String(notice.name || '').slice(0, 40)}｜${result.turns || 0} 轮 ${result.tokens || 0} token${result.stoppedEarly ? '｜代码判断已够，提前收尾' : ''}｜累计 ${spentTokens}`);
    }
  }
  await Promise.all(Array.from({ length:Math.max(1, Math.min(concurrency, notices.length)) }, worker));
  return { generatedAt:new Date().toISOString(), method:provider === 'codex' ? 'codex_agent' : provider === 'deepseek' ? 'deepseek_agent' : 'kimi_agent', model:provider === 'codex' ? `${CODEX_MODEL}（推理 ${CODEX_REASONING_EFFORT}）` : provider === 'deepseek' ? dsModel : MODEL, tokens:spentTokens, verifyTokens, tokenBudget, stopReason,
    engines:search.summary ? search.summary() : [], results };
}

function readExtractKey() {
  try { return fs.readFileSync(path.join(HERE, '.extract-key'), 'utf8').trim(); } catch { return ''; }
}

function readKey() {
  if (process.env.AI_API_KEY) return process.env.AI_API_KEY.trim();
  return fs.readFileSync(path.join(HERE, '.ai-key'), 'utf8').replace(/^﻿/, '').trim().replace(/^[A-Z_]+=/, '').trim();
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const [noticesFile, outFile] = args.filter((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'));
  const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? Number(args[i + 1]) : fallback; };
  if (!noticesFile || !outFile) { console.error('用法：node notice-agent.mjs <通知文件> <输出文件> [--baidu-budget 10]'); process.exit(1); }
  const notices = (JSON.parse(fs.readFileSync(noticesFile, 'utf8')).candidates || []).filter(item => item.detailUrl);
  const extractKey = readExtractKey();
  if (!extractKey) throw new Error('通知代理配置错误：缺少 .extract-key，无法执行官方来源与当届核验；任务已停止，不降级为仅匹配引文。');
  const options = { baiduBudget:opt('baidu-budget', 10), kimiSearchBudget:opt('kimi-search-budget', 300), tokenBudget:opt('budget-tokens', 6000000),
    concurrency:opt('concurrency', 4), maxTurns:opt('max-turns', 6), perNoticeTokens:opt('per-notice-tokens', 60000),
    // 默认 Codex；其他提供方仅供显式回退，不因 Codex 出错自动替换模型。
    provider:(process.env.NOTICE_AGENT_PROVIDER || 'codex'),
    key:process.env.NOTICE_AGENT_PROVIDER === 'deepseek' ? extractKey : process.env.NOTICE_AGENT_PROVIDER === 'kimi' ? readKey() : '',
    readPage:createBeijingReader(await defaultPageReader()), blocked:await loadBlockedSites({ log:console.log }),
    // CLI 必须“提取 + 核对”，不能因缺少配置而降低线上来源门槛。
    verifyPage:(name, title, pages) => verifyOfficialSource(name, title, pages, { key:extractKey }) };
  console.log(`通知追溯（${options.provider === 'codex' ? 'Codex' : options.provider === 'deepseek' ? 'DeepSeek' : 'Kimi'} 代理）：${notices.length} 篇｜百度 ${options.baiduBudget} 次后换 Kimi 搜索｜token 上限 ${options.tokenBudget}｜同时 ${options.concurrency} 篇｜每篇最多 ${options.maxTurns} 轮、${options.perNoticeTokens} token｜读网页${options.verifyPage ? '提取要点并核对' : '返回全文'}`);
  const report = await runNoticeAgent(notices, options);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');
  const count = outcome => report.results.filter(item => item.agent.outcome === outcome).length;
  console.log(`通知追溯完成：找到官方来源 ${count('found_official')}，不是比赛 ${count('not_competition')}，只是赛区/校赛 ${count('sub_track')}，找不到 ${count('not_found')}，读不出 ${count('unreadable')}，没轮上 ${count('skipped_budget')}，出错 ${count('error') + count('bad_output')}｜token ${report.tokens}（读网页核对另用 DeepSeek ${report.verifyTokens}）${report.stopReason ? `｜提前停止：${report.stopReason}` : ''}`);
}
