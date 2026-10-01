// 对通知标题定向寻找赛事官网线索；搜索结果只供核验，不能自动称为官方来源。
import { baiduEngine, createSearcher, deepseekEngine, kimiEngine } from './search-engines.mjs';
import { linksFromNoticePage } from './notice-page-links.mjs';
import { isUnreadableHost } from './unreadable-hosts.mjs';
import fs from 'node:fs/promises';
import { setDefaultResultOrder } from 'node:dns';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { leadRank } from './trace-drafts.mjs';
import { urlsInText } from './known-event-mentions.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
setDefaultResultOrder('ipv4first');

export function competitionNameFromNotice(title) {
  const name = String(title || '').replace(/^(?:【?通知】?|赛事通知[：:]|转发)/, '')
    .replace(/^关于(?:组织|选拔|参加|举办|开展|做好|转发)*[^“”]{0,45}?[“「]([^”」]+)[”」].*$/, '$1')
    .replace(/^关于(?:组织|参加|举办|开展|做好)?/, '')
    .replace(/(?:的)?(?:报名|参赛|选拔)?通知.*$/, '')
    .trim();
  // “省大学生科技赛事——省大学生结构设计竞赛”中后半段才是独立赛事。
  const lastSegment = name.split(/[—–]{2,}/).at(-1).trim();
  return /(?:竞赛|大赛|挑战赛|比赛)$/.test(lastSegment) ? lastSegment : name;
}

// 标题没有信息量、或页面读不了（微信公众号）时，赛事名只能从摘要里找：“……举办 2026 年‘强国杯’英语能力大赛……”。
// 只认“举办/开展/组织/主办/承办/举行/启动/征集/参加”这类动词后面跟着的、以“大赛/竞赛/挑战赛/比赛/联赛/锦标赛”结尾的名字，
// 找不到就不猜（宁可不追溯，也不拿一段不是赛事名的话去搜）。
const SNIPPET_NAME = /(?:举办|主办|承办|开展|组织|举行|启动|征集|参加)了?(?:第[一二三四五六七八九十百\d]+届)?((?:(?:19|20)\d{2}\s*年?)?[“"「『]?[一-龥A-Za-z0-9“”"「」『』·+&（）()\-]{2,30}?(?:大赛|竞赛|挑战赛|比赛|联赛|锦标赛))/;
export function contestNameFromSnippet(text) {
  const match = String(text || '').replace(/\s+/g, '').match(SNIPPET_NAME);
  if (!match) return '';
  const name = parentCompetitionName(match[1]);
  return VALID_NAME(name.replace(/(?:19|20)\d{2}\s*年?|第[一二三四五六七八九十百\d]+届|[“”"「」\s]/g, '')) ? name : '';
}

// 追溯用的候选：标题没有信息量、或页面读不了的，赛事名换成摘要里提取的（原标题留在 originalTitle）；提取不到的原样返回，后面按“提不出赛事名”处理
export function withTraceName(candidate, { replaceTitle = false } = {}) {
  if (!replaceTitle) return candidate;
  const name = contestNameFromSnippet(candidate.introduction || candidate.description || '');
  return name ? { ...candidate, name, originalTitle:candidate.name, nameFromSnippet:true } : candidate;
}

// 已经知道比赛名：直接“比赛名 报名入口”去搜，找最新的官网（2026-10-01，用户定；
// 实测“全国大学生生命科学竞赛报名入口”百度第 1 条就是官网 culsc.cn）
export function followupQuery(title) {
  return `${competitionNameFromNotice(title)} 报名入口`;
}

// 页面文字里是不是在说这场比赛：赛事名核心词的相邻两字组（“热处”“处理”……）大部分对得上就算（2026-10-01）。
// 原先要求整串原样包含，通知里叫“材料热处理创新创业大赛”、官网自己写“材料热处理创新创业赛”，差一个“大”字，官网就被筛掉了。
// 阈值 0.7：核心词有 10 组，7 组以上出现；别的比赛（“机械工程创新创意大赛”）只会碰上“创新”“大赛”两三组，不会误放。
export const CORE_MATCH_RATIO = 0.7;
const squash = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
export function coreMatches(text, core, ratio = CORE_MATCH_RATIO) {
  const target = squash(core);
  if (!target) return true;
  const haystack = squash(text);
  if (haystack.includes(target)) return true;
  if (target.length < 4) return false;
  const grams = [];
  for (let i = 0; i < target.length - 1; i += 1) grams.push(target.slice(i, i + 2));
  return grams.filter(gram => haystack.includes(gram)).length / grams.length >= ratio;
}

export function selectLeads(references, noticeUrl, proposedName = '') {
  let noticeHost = '';
  try { noticeHost = new URL(noticeUrl).hostname; } catch {}
  const identity = String(proposedName).replace(/^(?:全国|中国|[\u4e00-\u9fa5]{2,8}省|[\u4e00-\u9fa5]{2,8}市)?(?:第[一二三四五六七八九十百\d]+届)?(?:大学生|高校学生|高校)?/, '');
  const core = identity.length >= 5 ? identity : proposedName;
  return (references || []).filter(item => {
    try {
      const url = new URL(item.url);
      const text = `${item.title || ''} ${item.content || ''}`;
      // http 的官网也收（如节能减排竞赛官网）；公众号、百科、问答不收
      return /^https?:$/.test(url.protocol) && url.hostname !== noticeHost && leadRank(item.url) < 9 && /赛事|竞赛|比赛|大赛|报名|组委会/.test(text)
        && coreMatches(text, core);
    } catch { return false; }
  }).slice(0, 5).map(item => ({ title:String(item.title || '').slice(0, 150), url:item.url, summary:String(item.content || '').slice(0, 300), status:'待核验' }));
}

// 通知正文里亲口写出的网址（报名网址、官网），可靠性远高于搜索搜到的：直接放行去读，
// 不再让 Jev 只看域名（标题是域名、介绍是一句来源说明）再判一次——那样判出来几乎都是“拿不准”，
// 2026-09-29 那轮 15 个追溯页面里的官网全因此没人读（2026-10-01 起）。
// 仍然要过主流水线的判重、读详情后的范围检查和三项核验，不会因此免审。
export function splitTrustedFollowups(followups = []) {
  const trusted = followups.filter(candidate => candidate.fromNoticeText);
  const others = followups.filter(candidate => !candidate.fromNoticeText);
  const decisions = trusted.map(candidate => ({
    candidate, action:'fetch', kind:'competition_site', confidence:1, source:'notice_text',
    reason:'通知正文里写出的网址，直接读取', probabilities:null, cost:0,
  }));
  return { trusted, others, decisions };
}

// 通知只是来源线索。追溯到的页面必须在主流水线再次判重、分类、抓正文和核验；
// 这里绝不把通知标题本身转换成赛事记录。
export function followupCandidatesFromReport(report = {}) {
  const seen = new Set();
  const candidates = [];
  for (const result of report.results || []) {
    const proposedName = String(result.proposedName || '').trim();
    if (!/(?:竞赛|大赛|挑战赛|比赛|联赛|锦标赛|赛)$/.test(proposedName)
      || /通知|公告|公示|目录|清单|校赛|校内选拔|校级选拔/.test(proposedName)) continue;
    for (const lead of result.leads || []) {
      const url = String(lead.url || '');
      if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url);
      candidates.push({
        externalId:`notice-followup-${createHash('sha256').update(url).digest('hex').slice(0, 16)}`,
        name:String(lead.title || '').trim(), // Jev 先判断真实页面标题，不能只看推测的比赛名。
        proposedCompetitionName:proposedName,
        detailUrl:url,
        introduction:`通知提出的待核验比赛名：${proposedName}。搜索摘要：${String(lead.summary || '')}`.slice(0, 2000),
        discoveryNoticeUrl:String(result.noticeUrl || ''),
        // 网址是通知正文里自己写出来的（不是搜索搜到的），前置筛选不再复判（见 trustedFollowupDecisions）
        fromNoticeText:Boolean(lead.fromNoticeText),
        tags:[],
        source:'通知追溯',
        discovery:{
          route:'追溯线索与主办方监测', query:result.followupQuery || null, source:'通知追溯',
          via:{ noticeUrl:String(result.noticeUrl || ''), noticeTitle:String(result.noticeTitle || ''), ...(result.noticeDiscovery ? { discovery:result.noticeDiscovery } : {}) },
        },
      });
    }
  }
  return candidates;
}

// 能追溯的上级赛事名：以“赛”结尾、至少 6 个字（“比赛”“大赛”这种太笼统）；
// 学院自己办的（名字以某某学院开头、或带“院级”）没有上级赛事可追，不占搜索额度。
const VALID_NAME = name => /(?:竞赛|大赛|挑战赛|比赛|联赛|锦标赛|赛)$/.test(name) && name.length >= 6
  && !/通知|公告|公示|目录|清单|校赛|校内选拔|校级选拔|院级/.test(name)
  && !/^[一-龥]{2,14}学院(?!杯)/.test(name);

// 按上级赛事分组：同一场比赛的多篇通知只搜一次；摘要里直接写出的网址一并收集
// 校内选拔、校赛、初赛这类通知，上级赛事名就是去掉结尾选拔环节后的部分：
// “第八届全国大学生混凝土材料设计大赛校内选拔赛” → “第八届全国大学生混凝土材料设计大赛”
export function parentCompetitionName(title) {
  // 先去掉栏目标签：“以赛促学|外教社杯……”取分隔符之后；“【竞赛通知】……”去掉方括号标签
  const cleaned = String(title || '').split(/[|｜丨]/).map(part => part.trim()).filter(Boolean).at(-1) || '';
  let name = competitionNameFromNotice(cleaned.replace(/^(?:【[^】]*】\s*)+/, ''));
  name = name
    .replace(/^(?:[一-龥]{2,12}(?:大学|学院))?(?:关于)?(?:组织|开展|举办|参加|做好|转发)+(?:参加)?/, '')
    .replace(/[(（]\s*\d+\s*届\s*[)）]/g, '')
    // 只处理比赛名之后的部分：“……竞赛河南城建学院校赛”“……大赛郑州大学选拔赛”“……大赛校内选拔赛”
    .replace(/(竞赛|大赛|挑战赛|比赛)[一-龥]{0,12}?(?:校内|校级|院级|校园)?(?:选拔赛?|预选赛|初赛|校赛|院赛)$/, '$1')
    .replace(/^[一-龥]{2,12}?(?:大学|学院)(?=(?:19|20)\d{2}|第)/, '');
  return name.trim();
}

export function groupNotices(candidates = []) {
  const groups = new Map();
  for (const candidate of candidates) {
    const proposedName = parentCompetitionName(candidate.name);
    if (!VALID_NAME(proposedName)) continue;
    // 分组和搜索都用去掉年份、届次、引号后的名字：同一场比赛不同届的通知归成一组
    const key = proposedName.replace(/(?:19|20)\d{2}\s*年?|第[一二三四五六七八九十百\d]+届|[“”"「」\s]/g, '');
    if (!groups.has(key)) groups.set(key, { proposedName:key, notices:[] });
    groups.get(key).notices.push({ title:candidate.name, url:candidate.detailUrl, discovery:candidate.discovery || null,
      urls:urlsInText(candidate.introduction, candidate.detailUrl).filter(url => leadRank(url) < 9).slice(0, 5) });
  }
  return [...groups.values()];
}

// 重要程度：提到它的通知越多越优先；带当年或明年年份的优先；全国性的优先于省级、省级优先于其他；
// 摘要里已经写出网址的稍靠后（不搜也有线索）。
export function noticeImportance(group, year = new Date().getFullYear()) {
  const text = group.notices.map(notice => notice.title).join(' ');
  const recent = new RegExp(`${year}|${year + 1}`).test(text) ? 2 : 0;
  const level = /^(?:全国|中国|国际)/.test(group.proposedName) ? 2 : /^[一-龥]{2,3}(?:省|市|自治区)/.test(group.proposedName) ? 1 : 0;
  const free = group.notices.some(notice => notice.urls.length) ? -1 : 0;
  return group.notices.length * 2 + recent + level + free;
}

// 用法: node resolve-notice-leads.mjs <候选文件> <结果文件> [--budget 10] [--kimi-budget 15] [--deepseek-budget 15]
// 搜索引擎依次补位：百度（--budget 次）→ Kimi（--kimi-budget 次）→ DeepSeek（--deepseek-budget 次），见 search-engines.mjs。
// 每个赛事组留下“用了哪个引擎、返回了什么、保留了哪几条”（result.search），后台明细据此显示。
// 2026-09-29 起：所有通知（含校内选拔、学校转发、赛事报道）都能追溯；按上级赛事分组，
// 搜索额度按重要程度分配，摘要里写出的网址不花额度直接作为线索。
async function main() {
  const argv = process.argv.slice(2);
  const input = argv[0];
  const output = argv[1];
  const numberFlag = (flag, fallback) => (argv.includes(flag) ? Math.max(0, Number(argv[argv.indexOf(flag) + 1]) || 0) : fallback);
  const budget = numberFlag('--budget', 10);
  const kimiBudget = numberFlag('--kimi-budget', 15);
  const deepseekBudget = numberFlag('--deepseek-budget', 15);
  if (!input || !output) throw new Error('用法: node resolve-notice-leads.mjs <候选文件> <结果文件> [--budget 10]');
  const { candidates = [] } = JSON.parse(await fs.readFile(path.resolve(HERE, input), 'utf8'));
  const groups = groupNotices(candidates).sort((a, b) => noticeImportance(b) - noticeImportance(a));
  const searcher = createSearcher([{ engine:baiduEngine(), budget }, { engine:kimiEngine(), budget:kimiBudget }, { engine:deepseekEngine(), budget:deepseekBudget }]);
  // 访问通知页面用的抓取器（遵守 robots、同一网站间隔 1.5 秒）；服务器上在 ./crawler/lib/，仓库里在 ../crawler/lib/
  const { Fetcher } = await import('./crawler/lib/fetcher.mjs').catch(() => import('../crawler/lib/fetcher.mjs'));
  const fetcher = new Fetcher({ perHostDelayMs:1500 });
  const results = [];
  let searched = 0;
  let visitedWithLinks = 0;
  for (const group of groups) {
    const first = group.notices[0];
    // 标题用网站域名：原先把来源通知标题放进标题，追溯阶段“标题含通知就跳过”的规则把这些官网全拦了（2026-09-30）
    const hostOf = url => { try { return new URL(url).hostname; } catch { return url; } };
    const free = group.notices.flatMap(notice => notice.urls.map(url => ({ title:hostOf(url), url, summary:`通知摘要里写出的网址，来自：${notice.title.slice(0, 60)}`, status:'待核验', fromNoticeText:true })));
    const result = { noticeUrl:first.url, noticeTitle:first.title, noticeDiscovery:first.discovery, notices:group.notices.map(({ discovery, ...notice }) => notice),
      proposedName:group.proposedName, importance:noticeImportance(group), leads:free };
    // 追溯分两种（2026-10-01，用户定）：
    // ① 页面能读：直接访问通知页面，提取页面里写出的官网、报名网址（不花搜索额度）；组里的通知按顺序试，读到一篇就停，最多试两篇
    const visits = [];
    for (const notice of group.notices) {
      if (visits.some(visit => visit.status === 'ok') || visits.length >= 2) break;
      if (isUnreadableHost(notice.url)) { visits.push({ url:notice.url, status:'unreadable_host', found:0 }); continue; }
      const page = await fetcher.get(notice.url);
      if (page.status !== 'ok' || !/html/i.test(page.contentType || '')) { visits.push({ url:notice.url, status:page.status === 'ok' ? 'not_html' : page.status, found:0 }); continue; }
      const links = linksFromNoticePage(page.text, page.finalUrl || notice.url);
      const known = new Set(result.leads.map(lead => lead.url));
      const fresh = links.filter(link => !known.has(link.url));
      result.leads.push(...fresh.map(link => ({ title:link.label || hostOf(link.url), url:link.url, status:'待核验', fromNoticeText:true, fromPage:true,
        summary:`通知页面里写出的网址${link.label ? `（${link.label}）` : ''}，来自：${notice.title.slice(0, 60)}` })));
      visits.push({ url:notice.url, status:'ok', found:fresh.length });
    }
    const pageFound = visits.reduce((sum, visit) => sum + visit.found, 0);
    result.pageVisit = { visits, found:pageFound };
    if (pageFound) visitedWithLinks += 1;
    // ② 已经知道比赛名、但页面读不了或页面里没写网址：用“比赛名 报名入口”搜索（百度 → Kimi → DeepSeek 依次补位）。
    //    页面或摘要里已经写出网址的，不再花搜索额度
    const query = followupQuery(group.proposedName);
    const outcome = result.leads.length ? null : await searcher.search(query);
    if (result.leads.length) result.searchSkipped = pageFound ? '通知页面里已经写出网址，不再搜索' : '通知摘要里已经写出网址，不再搜索';
    if (outcome) {
      // 有引擎接了这次搜索（成功，或者都失败了）：记下查询词；全都没额度才算“没轮上”，不带查询词
      result.followupQuery = query;
      if (outcome.failed) {
        result.error = outcome.attempts.map(item => `${item.label}：${item.error}`).join('；');
      } else {
        const seen = new Set(free.map(lead => lead.url));
        const kept = selectLeads(outcome.references, first.url, group.proposedName).filter(lead => !seen.has(lead.url));
        result.leads.push(...kept);
        searched += 1;
        const keptUrls = new Set(kept.map(lead => lead.url));
        result.search = {
          engine:outcome.engine, label:outcome.label, query, returned:outcome.references.length, kept:kept.length,
          results:outcome.references.map(item => ({ title:item.title.slice(0, 120), url:item.url, kept:keptUrls.has(item.url) })),
          attempts:outcome.attempts,
        };
      }
      if (outcome.attempts.length > 1 || outcome.failed) result.searchAttempts = outcome.attempts;
    }
    results.push(result);
  }
  const engines = searcher.summary();
  await fs.writeFile(path.resolve(HERE, output), JSON.stringify({ engines, results }, null, 2), 'utf8');
  console.log(`通知 ${candidates.length} 条 → 上级赛事 ${groups.length} 场；访问通知页面提取到网址 ${visitedWithLinks} 场；搜索 ${searched} 场（${engines.map(item => `${item.label} ${item.used}/${item.used + item.left}${item.disabled ? '，已停用' : ''}`).join('、')}）；找到待核验页面 ${results.reduce((sum, item) => sum + item.leads.length, 0)} 条`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
