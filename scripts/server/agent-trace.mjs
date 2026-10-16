// 通知追溯“代理版”（2026-10-04 试验）：把一篇通知交给带工具的 AI 代理，自己搜索、读页面、换办法，
// 直到找出这场比赛自己的官方来源并整理好字段，或者说明为什么不是比赛、为什么找不到。
//
// 和原来的追溯（resolve-notice-leads.mjs + 追溯页面筛选）的区别：
//   原来：每个环节只做一次一次性的小判断（提名字 → 搜一次 → Jev 判一次），读不出来就结束；
//   代理：同一个模型连续多轮——读到空壳页就换读法、读到旧届通知就去搜新一届、找到官网后读正文核对字段。
//
// 只读：不写库、不改任何运行文件，结果写到 <运行目录>/agent-trace-results.jsonl，由 agent-trace-compare.mjs 对比。
// 模型：走 Kimi 会员通道（api.kimi.com/coding，.ai-key，kimi-for-coding），不用 OpenRouter（OpenRouter 只给 Jev 前置筛选用）。
// 用法：node agent-trace.mjs <运行目录> [--limit N] [--budget-tokens 6000000] [--max-turns 10] [--concurrency 4] [--out 文件]
import fs from 'node:fs';
import path from 'node:path';
import { kimiEngine, kimiFetchPage } from './search-engines.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const runDir = args.find(arg => !arg.startsWith('--'));
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
if (!runDir) { console.error('用法：node agent-trace.mjs <运行目录> [--limit N] [--budget-tokens 6000000] [--max-turns 10] [--concurrency 4]'); process.exit(1); }
const MODEL = opt('model', 'kimi-for-coding');
const BASE_URL = process.env.AGENT_BASE_URL || 'https://api.kimi.com/coding/v1';
const TOKEN_BUDGET = Number(opt('budget-tokens', '6000000'));
const MAX_TURNS = Number(opt('max-turns', '10'));
const CONCURRENCY = Number(opt('concurrency', '4'));
const LIMIT = Number(opt('limit', '0'));
const OUT = opt('out', path.join(runDir, 'agent-trace-results.jsonl'));

function readKey() {
  if (process.env.AI_API_KEY) return process.env.AI_API_KEY.trim();
  const file = path.join(HERE, '.ai-key');
  return fs.readFileSync(file, 'utf8').replace(/^﻿/, '').trim().replace(/^[A-Z_]+=/, '').trim();
}
const KEY = readKey();
const TODAY = new Date().toISOString().slice(0, 10);

const SYSTEM = `你是“每日竞赛”小程序的赛事核对员。小程序收录面向在校大学生/研究生的各类学科竞赛。今天是 ${TODAY}。
你拿到的是夜间抓取到的一篇通知或新闻的标题和摘要（多半是学校转发的校内选拔通知、赛果新闻）。你的任务：
1. 判断它背后是不是一场值得收录的比赛。不是比赛的（奖学金/助学金评选、招聘、招生、教师赛、职工技能竞赛、纯学术会议、只面向企业人员的赛事、单校内部比赛）直接结论“不是比赛”。
2. 是比赛的：找出这场比赛自己的**官方来源**——主办方/组委会/主管部门（教育部、教育厅、行业学会、协会）的官网或正式通知。学校转发、新闻、公众号、竞赛聚合站（52jingsai、saikr 等）只能当线索，不能当来源。
   - 如果通知是某全国大赛的省赛区、校内选拔赛，要追到上级全国赛事，以上级赛事为准；上级赛事的官网才是来源。
   - 官网读到旧一届时，去找最新一届；读到空壳页面（只有几十字）就换办法：搜它的通知、找学会/协会网站上的公告、读附件 PDF。
3. 找到官方来源后读正文，核对字段：主办单位、参赛对象（必须写明大学生/本科/研究生/高职等，照原文）、报名起止、比赛时间、报名入口、费用、奖项。
   原则：没核到的不写。每个字段都必须在官方来源原文里找到，找不到就留空，绝不推断、不编造日期和网址。
工具：web_search(query)（返回标题、网址、摘要）、fetch_page(url, start)（读网页或 PDF 正文，每次最多 6000 字，start 是起始位置）。最多使用 ${MAX_TURNS - 1} 轮工具，要节约。
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

const TOOLS = [
  { type: 'function', function: { name: 'web_search', description: '联网搜索，返回最多 8 条结果（标题、网址、摘要）', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'fetch_page', description: '读取网页或 PDF 正文（脚本渲染的页面也能读），每次最多 6000 字', parameters: { type: 'object', properties: { url: { type: 'string' }, start: { type: 'integer', description: '起始字符位置，默认 0' } }, required: ['url'] } } },
];

// 代理只用 Kimi 自己的搜索，不占百度额度（2026-10-10）
const engines = [kimiEngine()];
let spentTokens = 0;
let stopAll = false;
const pageCache = new Map();

async function toolSearch(query) {
  for (const engine of engines) {
    try {
      const { references } = await engine.search(String(query).slice(0, 120));
      if (!references?.length) continue;
      return references.slice(0, 8).map(r => `${String(r.title).slice(0, 60)} | ${r.url} | ${String(r.content || r.summary || '').replace(/\s+/g, ' ').slice(0, 160)}`).join('\n');
    } catch { /* 换下一个引擎 */ }
  }
  return '（搜索没有结果或全部引擎失败）';
}

async function toolFetch(url, start = 0) {
  const key = String(url);
  if (!/^https?:\/\//i.test(key)) return '（只能读 http/https 网址）';
  try {
    let text = pageCache.get(key);
    if (text === undefined) { text = (await kimiFetchPage(key)).markdown || ''; pageCache.set(key, text); }
    if (!text.trim()) return '（页面读到了，但没有文字内容）';
    const piece = text.slice(Number(start) || 0, (Number(start) || 0) + 6000);
    return `（全文 ${text.length} 字，这是第 ${Number(start) || 0} 起的内容）\n${piece}`;
  } catch (error) { return `（读取失败：${String(error.message || error).slice(0, 120)}）`; }
}

async function chat(messages, withTools) {
  // Kimi 会员通道不接受 temperature；它会先做内部推理，max_tokens 要留够
  const body = { model: MODEL, messages, max_tokens: 8000 };
  if (withTools) { body.tools = TOOLS; body.tool_choice = 'auto'; }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${BASE_URL}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(150000) });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.choices?.[0]) { const used = Number(data.usage?.total_tokens) || 0; spentTokens += used; data._tokens = used; return data; }
    if (![429, 500, 502, 503, 504].includes(response.status)) throw new Error(`模型调用失败 ${response.status} ${JSON.stringify(data).slice(0, 200)}`);
    await new Promise(resolve => setTimeout(resolve, 3000 * (attempt + 1)));
  }
  throw new Error('模型调用多次失败');
}

function parseJson(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

async function runOne(notice) {
  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: `通知标题：${notice.name}\n通知网址：${notice.detailUrl}\n摘要：${String(notice.introduction || '').replace(/\s+/g, ' ').slice(0, 500)}\n（发现这篇通知的搜索：${notice.matchedQuery || notice.discovery?.query || ''}）` }];
  const trace = [];
  let own = 0; // 这一篇自己用的 token（多篇并发时不能用总量相减）
  let turns = 0;
  for (; turns < MAX_TURNS; turns += 1) {
    if (stopAll) return { outcome: 'skipped_budget', reason: 'token 上限，没处理', trace };
    const last = turns === MAX_TURNS - 1;
    if (last) messages.push({ role: 'user', content: '工具次数用完了。请现在只回复最终 JSON。' });
    const data = await chat(messages, !last);
    own += data._tokens || 0;
    const message = data.choices[0].message;
    messages.push({ role: 'assistant', content: message.content || '', ...(message.reasoning_content ? { reasoning_content: message.reasoning_content } : {}), ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}) });
    if (!message.tool_calls?.length) {
      const result = parseJson(message.content);
      return { ...(result || { outcome: 'bad_output', reason: String(message.content || '').slice(0, 200) }), trace, turns: turns + 1, tokens: own };
    }
    for (const call of message.tool_calls) {
      let parsed = {};
      try { parsed = JSON.parse(call.function.arguments || '{}'); } catch { /* 空参数 */ }
      const output = call.function.name === 'web_search' ? await toolSearch(parsed.query) : call.function.name === 'fetch_page' ? await toolFetch(parsed.url, parsed.start) : '（没有这个工具）';
      trace.push({ tool: call.function.name, input: parsed.query || parsed.url || '', outputChars: output.length });
      messages.push({ role: 'tool', tool_call_id: call.id, content: output });
    }
    if (spentTokens >= TOKEN_BUDGET) stopAll = true;
  }
  return { outcome: 'bad_output', reason: '超过最大轮数', trace, turns, tokens: own };
}

const notices = (JSON.parse(fs.readFileSync(path.join(runDir, 'formal-notices.json'), 'utf8')).candidates || []);
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line).noticeUrl) : []);
const queue = notices.filter(item => item.detailUrl && !done.has(item.detailUrl)).slice(0, LIMIT || undefined);
console.log(`模型 ${MODEL}｜通知 ${notices.length} 条，本次处理 ${queue.length} 条（已有结果 ${done.size} 条跳过）｜token 上限 ${TOKEN_BUDGET}｜最多 ${MAX_TURNS} 轮｜并发 ${CONCURRENCY}`);

let index = 0;
let finished = 0;
async function worker() {
  while (index < queue.length && !stopAll) {
    const notice = queue[index++];
    let result;
    try { result = await runOne(notice); } catch (error) { result = { outcome: 'error', reason: String(error.message || error).slice(0, 200) }; }
    fs.appendFileSync(OUT, `${JSON.stringify({ noticeUrl: notice.detailUrl, noticeTitle: notice.name, model: MODEL, at: new Date().toISOString(), ...result })}\n`);
    finished += 1;
    console.log(`[${finished}/${queue.length}] ${result.outcome} ${notice.name.slice(0, 40)}｜${result.turns || 0} 轮 ${result.tokens || 0} token｜累计 ${spentTokens}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`完成：处理 ${finished} 条，累计 ${spentTokens} token${stopAll ? '（达到 token 上限，提前停止）' : ''}。结果：${OUT}`);
