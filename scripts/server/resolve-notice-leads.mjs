// 对通知标题定向寻找赛事官网线索；搜索结果只供核验，不能自动称为官方来源。
import fs from 'node:fs/promises';
import { setDefaultResultOrder } from 'node:dns';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { leadRank } from './trace-drafts.mjs';
import { urlsInText } from './known-event-mentions.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
setDefaultResultOrder('ipv4first');
const SEARCH_URL = 'https://qianfan.baidubce.com/v2/ai_search/web_search';

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

export function followupQuery(title) {
  return `${competitionNameFromNotice(title)} 主办方 赛事官网 官方报名`;
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
        && (!core || text.includes(core));
    } catch { return false; }
  }).slice(0, 5).map(item => ({ title:String(item.title || '').slice(0, 150), url:item.url, summary:String(item.content || '').slice(0, 300), status:'待核验' }));
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

async function searchOnce(key, query) {
  const request = () => fetch(SEARCH_URL, {
    method:'POST', headers:{ 'X-Appbuilder-Authorization':`Bearer ${key}`, 'Content-Type':'application/json' },
    body:JSON.stringify({ messages:[{ content:query, role:'user' }], search_source:'baidu_search_v2', resource_type_filter:[{ type:'web', top_k:10 }] }),
    signal:AbortSignal.timeout(20000),
  });
  let response;
  try { response = await request(); }
  catch {
    await new Promise(resolve => setTimeout(resolve, 500));
    response = await request();
  }
  if (!response.ok) throw new Error(`http_${response.status}`);
  return (await response.json()).references || [];
}

// 用法: node resolve-notice-leads.mjs <候选文件> <结果文件> [--budget 10]
// 2026-09-29 起：所有通知（含校内选拔、学校转发、赛事报道）都能追溯；按上级赛事分组，
// 搜索额度按重要程度分配，摘要里写出的网址不花额度直接作为线索。
async function main() {
  const argv = process.argv.slice(2);
  const input = argv[0];
  const output = argv[1];
  const budget = argv.includes('--budget') ? Math.max(0, Number(argv[argv.indexOf('--budget') + 1]) || 0) : 10;
  if (!input || !output) throw new Error('用法: node resolve-notice-leads.mjs <候选文件> <结果文件> [--budget 10]');
  const { candidates = [] } = JSON.parse(await fs.readFile(path.resolve(HERE, input), 'utf8'));
  const groups = groupNotices(candidates).sort((a, b) => noticeImportance(b) - noticeImportance(a));
  const key = (await fs.readFile(path.join(HERE, '.baidu-search-key'), 'utf8')).trim();
  const results = [];
  let searched = 0;
  for (const [index, group] of groups.entries()) {
    const first = group.notices[0];
    const free = group.notices.flatMap(notice => notice.urls.map(url => ({ title:`通知摘要里写出的网址（来自：${notice.title.slice(0, 40)}）`, url, summary:'', status:'待核验' })));
    const result = { noticeUrl:first.url, noticeTitle:first.title, noticeDiscovery:first.discovery, notices:group.notices.map(({ discovery, ...notice }) => notice),
      proposedName:group.proposedName, importance:noticeImportance(group), leads:free };
    if (index < budget) {
      result.followupQuery = followupQuery(group.proposedName);
      try {
        const references = await searchOnce(key, result.followupQuery);
        const seen = new Set(free.map(lead => lead.url));
        result.leads.push(...selectLeads(references, first.url, group.proposedName).filter(lead => !seen.has(lead.url)));
        searched += 1;
      } catch (error) {
        result.error = String(error?.message || error);
      }
    }
    results.push(result);
  }
  await fs.writeFile(path.resolve(HERE, output), JSON.stringify({ results }, null, 2), 'utf8');
  console.log(`通知 ${candidates.length} 条 → 上级赛事 ${groups.length} 场；搜索 ${searched} 场（额度 ${budget}）；找到待核验页面 ${results.reduce((sum, item) => sum + item.leads.length, 0)} 条`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
