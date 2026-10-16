// 通知追溯的固定步骤（2026-10-12，用户定）：认出比赛名以后，先用固定步骤找官方来源，找不到的才交给 Kimi 代理。
//
// 为什么：代理每篇自己摸索，花费和出错都集中在少数难题上（16 篇对比测试：9～10 轮的 5 篇用掉 67% 的 token，
// 也是拿新浪、公众号当来源、带上旧一届页面的那几篇）；而大部分通知按固定步骤就能找到（旧版一次性搜索找到的入库 13 场里 12 场）。
//
// 每篇的步骤：
//   1. 官网记忆（plans/official-sites.json）：30 天内核实过这场比赛的官网，直接读，不搜。
//   2. 搜索：两个固定搜索词同时发（“比赛名 年份 通知”“比赛名 官网”），Kimi 搜索；屏蔽名单里的网站去掉。
//   3. 挑候选（rankOfficialCandidates）：按标题、网站类型、日期打分，排除转载站、扣掉学校转发和新闻，取前 2 个。
//   4. 读网页（page-reader.mjs）：自己抓（遵守 robots），空壳页用 Kimi 读网页，PDF、Word 都能读。
//   5. 一次核对（verifyOfficialSource，DeepSeek-Flash，不思考）：判断是不是官方来源、摘出主办、参赛对象、届次、报名时间，
//      每项带原文；代码逐字核对（checkVerification），不信模型的结论。
// 结果：核到官方来源 → 和代理同样格式的结论（toLeadResult），去读详情；两次都判为不是比赛 → 结论“不是比赛”；
//       其余交给代理，并把“搜过什么、读过什么、为什么没核到”带过去，代理不重复。
import fs from 'node:fs';
import { toLeadResult } from './notice-agent.mjs';
import { isBlockedHost, normalizeHost } from './site-blocklist.mjs';
import { REPOST_HOSTS, checkVerification, flat, quoteFound, verifyOfficialSource } from './source-check.mjs';

export { REPOST_HOSTS, checkVerification, flat, quoteFound, verifyOfficialSource };

export const SITE_MEMORY_DAYS = 30;
const DAY = 86400000;

// 比赛名的记忆键：再去掉年份和届次
export const contestKey = name => flat(name).replace(/(?:19|20)\d{2}(?:[-~至](?:19|20)\d{2})?年?/g, '').replace(/第[零〇一二三四五六七八九十百\d]+届/g, '');

// ---- 官网记忆 ----
export function loadSiteMemory(file) {
  try { const data = JSON.parse(fs.readFileSync(file, 'utf8')); return data?.sites ? data : { version:1, sites:{} }; } catch { return { version:1, sites:{} }; }
}
export function saveSiteMemory(file, memory) { fs.writeFileSync(file, JSON.stringify(memory, null, 2), 'utf8'); }
export function lookupSite(memory, name, now = new Date()) {
  const entry = memory.sites[contestKey(name)];
  return entry && now.getTime() - Date.parse(entry.verifiedAt) < SITE_MEMORY_DAYS * DAY ? entry : null;
}
export function rememberSite(memory, { name, url, by, runId = '' }, now = new Date()) {
  const cutoff = now.getTime() - SITE_MEMORY_DAYS * DAY;
  const sites = Object.fromEntries(Object.entries(memory.sites).filter(([, entry]) => Date.parse(entry.verifiedAt) >= cutoff));
  const key = contestKey(name);
  sites[key] = { name, url, host:normalizeHost(url), verifiedAt:now.toISOString(), runId, by, hits:(memory.sites[key]?.hits || 0) + 1 };
  return { version:1, sites };
}

// ---- 挑候选 ----
const AUTHORITY_WORDS = /学会|协会|研究会|组委会|组织委员会|教育厅|教育委员会|教育部|科协|团委|共青团/;
const NOTICE_WORDS = /通知|公告|章程|报名|启动|规程|方案/;
const SCHOOL_REPOST = /^.{0,20}?(大学|学院|学校).{0,12}?关于.*(校内|校赛|校级|院赛|院级|选拔|组织参加|报名参加)/;
const NEWS_WORDS = /获奖|喜报|斩获|荣获|圆满|落幕|举行|闭幕|收官/;

function coverage(name, text) {
  const core = flat(name).replace(/(全国|中国|国际|全球|大学生|研究生|高校|竞赛|大赛|比赛|挑战赛|赛道|年度)/g, '');
  if (core.length < 2) return 0;
  const target = flat(text);
  const pairs = Array.from({ length:core.length - 1 }, (_, i) => core.slice(i, i + 2));
  return pairs.filter(pair => target.includes(pair)).length / pairs.length;
}

export function scoreCandidate(ref, name, year, now = new Date()) {
  const title = String(ref.title || '');
  const host = normalizeHost(ref.url);
  const reasons = [];
  let score = 0;
  if (coverage(name, title) >= 0.6) { score += 3; reasons.push('标题写着这场比赛'); }
  if (/\.gov\.cn$/.test(host)) { score += 2; reasons.push('政府网站'); }
  else if (/\.org(\.cn)?$/.test(host) || AUTHORITY_WORDS.test(title)) { score += 2; reasons.push('学会、协会或主管部门'); }
  if (NOTICE_WORDS.test(title)) { score += 1; reasons.push('通知类标题'); }
  if (new RegExp(`${year}|${year + 1}`).test(`${title} ${ref.date || ''}`)) { score += 1; reasons.push('今年或明年'); }
  const date = Date.parse(String(ref.date || '').replace(' ', 'T'));
  if (Number.isFinite(date) && now.getTime() - date < 183 * DAY) { score += 1; reasons.push('半年内发布'); }
  if (SCHOOL_REPOST.test(title)) { score -= 3; reasons.push('像学校转发（−3）'); }
  if (NEWS_WORDS.test(title)) { score -= 2; reasons.push('像新闻（−2）'); }
  return { score, reasons };
}

// 返回 { picked:[最多 2 个], rejected:[{ url, why }] }
export function rankOfficialCandidates(refs, name, year, { blocked = [], now = new Date(), minScore = 4, limit = 2 } = {}) {
  const rejected = [];
  const scored = [];
  const seenUrls = new Set();
  for (const ref of refs || []) {
    const url = String(ref?.url || '');
    if (!/^https?:\/\//i.test(url) || seenUrls.has(url)) continue;
    seenUrls.add(url);
    if (isBlockedHost(url, [...blocked, ...REPOST_HOSTS])) { rejected.push({ url, why:'转载、自媒体或屏蔽名单里的网站' }); continue; }
    const { score, reasons } = scoreCandidate(ref, name, year, now);
    scored.push({ ...ref, url, score, reasons });
  }
  scored.sort((a, b) => b.score - a.score);
  const picked = [];
  const hosts = new Set();
  for (const item of scored) {
    const host = normalizeHost(item.url);
    if (picked.length < limit && item.score >= minScore && !hosts.has(host)) { picked.push(item); hosts.add(host); continue; }
    rejected.push({ url:item.url, why:item.score < minScore ? `得分 ${item.score} 不够（${item.reasons.join('、') || '没有加分项'}）` : picked.length >= limit ? '前两个已选定' : '同一网站已选一个' });
  }
  return { picked, rejected };
}

// ---- 主流程 ----
export async function resolveNotices(named, { searchEngine, readPage, verify, siteMemory = { version:1, sites:{} }, blocked = [], now = new Date(),
  year = new Date(now.getTime() + 8 * 3600000).getUTCFullYear(), concurrency = 4, log = () => {} } = {}) {
  const results = [];
  const unresolved = [];
  const stats = { total:named.length, fromMemory:0, searched:0, read:0, verifyCalls:0, verifyTokens:0, resolved:0, notCompetition:0, unresolved:0 };
  let memory = siteMemory;
  let index = 0;

  async function handle({ notice, name, kind, editionYear }) {
    const tried = { queries:[], urls:[] };
    const trace = [];
    const pages = [];
    const remembered = lookupSite(memory, name, now);
    let candidates = [];
    if (remembered) { candidates = [{ url:remembered.url, title:remembered.name, reasons:['官网记忆'] }]; stats.fromMemory += 1; }
    else {
      const queries = [`${name} ${editionYear || year} 通知`, `${name} 官网`];
      tried.queries.push(...queries);
      const found = await Promise.all(queries.map(query => searchEngine.search(query).then(result => result?.references || []).catch(() => [])));
      stats.searched += queries.length;
      queries.forEach((query, i) => trace.push({ tool:'web_search', input:query, outputChars:found[i].length }));
      const ranked = rankOfficialCandidates(found.flat(), name, Number(editionYear) || year, { blocked, now });
      candidates = ranked.picked;
      tried.urls.push(...ranked.rejected.slice(0, 8));
    }
    for (const candidate of candidates) {
      const page = await readPage(candidate.url).catch(error => ({ status:'error', url:candidate.url, text:'', error:String(error?.message || error) }));
      stats.read += 1;
      trace.push({ tool:'fetch_page', input:candidate.url, outputChars:page.text?.length || 0 });
      if (page.status === 'ok') pages.push(page); else tried.urls.push({ url:candidate.url, why:`读不到（${page.status}${page.error ? `：${page.error.slice(0, 60)}` : ''}）` });
    }
    if (!pages.length) return { unresolved:{ notice, name, tried, reason:remembered ? '记忆里的官网读不到' : candidates.length ? '候选网页都读不到' : '搜索结果里没有像官方来源的网页' } };
    let check;
    let tokens = 0;
    try {
      const verified = await verify(name, notice.name, pages);
      stats.verifyCalls += 1; tokens = verified.tokens || 0; stats.verifyTokens += tokens;
      check = checkVerification(verified.result, pages, { year, noticeKind:kind, blocked });
    } catch (error) {
      check = { decision:'unresolved', reason:`核对调用失败：${String(error?.message || error).slice(0, 100)}` };
    }
    for (const page of pages) if (!(check.decision === 'found' && page === check.page)) tried.urls.push({ url:page.finalUrl || page.url, why:check.reason });
    if (check.decision === 'found') {
      const evidence = Object.entries(check.fields).map(([field, item]) => `${field}：「${item.quote}」`).join(' ').slice(0, 600);
      memory = rememberSite(memory, { name, url:check.page.finalUrl || check.page.url, by:'fixed' }, now);
      return { result:{ ...toLeadResult(notice, { outcome:'found_official', contest_name:name, reason:`固定步骤：${check.reason}`, trace, turns:0, tokens,
        sources:[{ url:check.page.finalUrl || check.page.url, type:'organizer_notice', evidence }] }), method:'fixed', fields:check.fields,
        followupQuery:tried.queries[0] || `固定步骤：官网记忆 ${remembered?.url || ''}` } };
    }
    if (check.decision === 'not_competition') return { result:{ ...toLeadResult(notice, { outcome:'not_competition', reason:`固定步骤：${check.reason}`, trace, turns:0, tokens }), method:'fixed',
      followupQuery:tried.queries[0] || '固定步骤：不是比赛' } };
    return { unresolved:{ notice, name, tried, reason:check.reason } };
  }

  async function worker() {
    while (index < named.length) {
      const item = named[index++];
      let outcome;
      try { outcome = await handle(item); } catch (error) { outcome = { unresolved:{ notice:item.notice, name:item.name, tried:{ queries:[], urls:[] }, reason:`固定步骤出错：${String(error?.message || error).slice(0, 100)}` } }; }
      if (outcome.result) { results.push(outcome.result); if (outcome.result.agent.outcome === 'found_official') stats.resolved += 1; else stats.notCompetition += 1; }
      else { unresolved.push(outcome.unresolved); stats.unresolved += 1; }
      log(`固定步骤 [${results.length + unresolved.length}/${named.length}] ${outcome.result ? outcome.result.agent.label : `交给代理（${outcome.unresolved.reason}）`}｜${item.name.slice(0, 30)}`);
    }
  }
  await Promise.all(Array.from({ length:Math.max(1, Math.min(concurrency, named.length)) }, worker));
  return { results, unresolved, stats, siteMemory:memory };
}

// 交给代理时附上的说明：固定步骤做过什么，代理不要重复
export function triedNote(tried, reason) {
  const parts = [];
  if (tried.queries.length) parts.push(`搜过「${tried.queries.join('」「')}」`);
  const urls = tried.urls.slice(0, 6).map(item => `${item.url}（${item.why}）`);
  if (urls.length) parts.push(`看过：${urls.join('；')}`);
  return parts.length ? `（固定步骤已试过：${parts.join('；')}。没核到的原因：${reason}。这些不要重复。）` : '';
}
