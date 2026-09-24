// 对通知标题定向寻找赛事官网线索；搜索结果只供核验，不能自动称为官方来源。
import fs from 'node:fs/promises';
import { setDefaultResultOrder } from 'node:dns';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

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
      return url.protocol === 'https:' && url.hostname !== noticeHost && /赛事|竞赛|比赛|大赛|报名|组委会/.test(text)
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
      if (!/^https:\/\//i.test(url) || seen.has(url)) continue;
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
      });
    }
  }
  return candidates;
}

async function main() {
  const input = process.argv[2];
  const output = process.argv[3];
  if (!input || !output) throw new Error('用法: node resolve-notice-leads.mjs <候选文件> <结果文件>');
  const { candidates = [] } = JSON.parse(await fs.readFile(path.resolve(HERE, input), 'utf8'));
  const noticeCandidates = candidates.filter(item => /^(关于|转发|【?通知】?|赛事通知[：:])|通知\s*_|(?:的通知|报名通知|参赛通知|选拔通知|的公告|报名公告)$/.test(item.name || ''));
  // 搜索服务有日配额；剩余线索保留待下一轮处理。
  const searchBatch = noticeCandidates.slice(0, 10);
  const key = (await fs.readFile(path.join(HERE, '.baidu-search-key'), 'utf8')).trim();
  const results = [];
  for (const candidate of searchBatch) {
    try {
      const request = () => fetch(SEARCH_URL, {
        method:'POST', headers:{ 'X-Appbuilder-Authorization':`Bearer ${key}`, 'Content-Type':'application/json' },
        body:JSON.stringify({ messages:[{ content:followupQuery(candidate.name), role:'user' }], search_source:'baidu_search_v2', resource_type_filter:[{ type:'web', top_k:10 }] }),
        signal:AbortSignal.timeout(20000),
      });
      let response;
      try { response = await request(); }
      catch {
        await new Promise(resolve => setTimeout(resolve, 500));
        response = await request();
      }
      if (!response.ok) throw new Error(`http_${response.status}`);
      const payload = await response.json();
      const proposedName = competitionNameFromNotice(candidate.name);
      results.push({ noticeUrl:candidate.detailUrl, noticeTitle:candidate.name, proposedName, leads:selectLeads(payload.references, candidate.detailUrl, proposedName) });
    } catch (error) {
      results.push({ noticeUrl:candidate.detailUrl, noticeTitle:candidate.name, proposedName:competitionNameFromNotice(candidate.name), leads:[], error:String(error?.message || error) });
    }
  }
  await fs.writeFile(path.resolve(HERE, output), JSON.stringify({ results }, null, 2), 'utf8');
  console.log(`通知线索 ${noticeCandidates.length} 条，本轮追溯 ${searchBatch.length} 条，找到待核验页面 ${results.reduce((sum, item) => sum + item.leads.length, 0)} 条`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
