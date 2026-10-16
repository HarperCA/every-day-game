// 记录追溯：按次日搜索计划（search-plan.mjs）里“追溯”路线的记录，用赛事全名搜当届通知，
// 把搜到的网址作为待核验线索挂到记录的 task 上。
//
// 只写处理任务字段（task：尝试次数、上次/下次检查时间、查询词、线索），不改任何事实字段和记录状态；
// 线索要人工或后续核验读原文确认后才能作为来源。
// 下次检查：找到新线索 7 天后复查；没找到按 2、4、8、16 天退避。
//
// 另外（2026-09-29 起）：凌晨抓取判重时命中“库里已有赛事”的通知（known-event-mentions.json），
// 用当天计划里闲置的搜索额度，按赛事名追溯当届官方来源；提到它的通知和摘要里写出的网址也一并挂上。
//
// 用法：node trace-drafts.mjs [--plan plans/search-plan-YYYY-MM-DD.json] [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { setDefaultResultOrder } from 'node:dns';
import { fileURLToPath } from 'node:url';
import { normalizeName } from './search-plan.mjs';
import { mentionSearchTargets, noticeLeads } from './known-event-mentions.mjs';
import { requireBaiduQuota } from './search-engines.mjs';

setDefaultResultOrder('ipv4first');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEARCH_URL = 'https://qianfan.baidubce.com/v2/ai_search/web_search';
const API = 'http://127.0.0.1:8787/api/adminData';
const MAX_LEADS = 10;

// 线索按网站类型排序：公众号、百科、问答这类不收；学校网站多是转发，排在协会、政府、赛事官网等之后。
// 按网址所属网站类型判断，不看标题关键词。
const SKIP_LEAD_HOSTS = /(^|\.)(mp\.weixin\.qq\.com|weixin\.qq\.com|baike\.baidu\.com|zhidao\.baidu\.com|zhihu\.com|bilibili\.com|douyin\.com|xiaohongshu\.com|wjx\.(?:cn|top)|kdocs\.cn|docs\.qq\.com)$/;
export function leadRank(url) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return 9; }
  if (SKIP_LEAD_HOSTS.test(host)) return 9;
  if (/\.edu\.cn$|\.edu$/.test(host)) return 2;
  return 1;
}

// 搜索结果里要出现赛事名的主体部分，且看起来是通知、章程、报名或赛事页；去掉已有来源和已有线索。
// 名称主体只去掉“全国”“中国”，省份保留——去掉省份会让“辽宁省……大赛”匹配到广西的同名比赛（2026-09-29 回放发现）。
export function pickLeads(references, record, now = new Date()) {
  const core = normalizeName(record.name).replace(/^(?:全国|中国)/, '').slice(0, 12);
  const known = new Set([...(record.sources || []).map(source => source.url), ...(record.task?.leads || []).map(lead => lead.url)]);
  const out = [];
  for (const item of references || []) {
    let parsed;
    try { parsed = new URL(item.url); } catch { continue; }
    if (!/^https?:$/.test(parsed.protocol) || known.has(item.url)) continue;
    const text = `${item.title || ''} ${item.content || ''}`;
    if (core.length >= 4 && !text.includes(core)) continue;
    if (!/通知|公告|章程|报名|赛事|竞赛|大赛|组委会/.test(text)) continue;
    if (leadRank(item.url) >= 9) continue;
    known.add(item.url);
    out.push({ url:item.url, title:String(item.title || '').slice(0, 150), summary:String(item.content || '').slice(0, 200), foundAt:now.toISOString(), status:'待核验' });
  }
  // 稳定排序：非学校网站在前，同类保持搜索引擎原来的先后
  return out.map((lead, index) => ({ lead, index })).sort((a, b) => leadRank(a.lead.url) - leadRank(b.lead.url) || a.index - b.index).slice(0, 5).map(item => item.lead);
}

export function nextTask(record, { query, leads, error = null }, now = new Date()) {
  const prev = record.task || {};
  const attempts = (prev.attempts || 0) + 1;
  const emptyStreak = error || leads.length ? (error ? prev.emptyStreak || 0 : 0) : (prev.emptyStreak || 0) + 1;
  const waitDays = error ? 1 : leads.length ? 7 : Math.min(16, 2 ** emptyStreak);
  return {
    ...prev,
    attempts, emptyStreak,
    firstAttemptAt:prev.firstAttemptAt || now.toISOString(),
    lastAttemptAt:now.toISOString(),
    nextCheckAt:new Date(now.getTime() + waitDays * 86400000).toISOString(),
    lastQuery:query,
    lastResult:error ? `搜索失败：${String(error).slice(0, 80)}` : leads.length ? `找到 ${leads.length} 条待核验线索` : '没有找到新线索',
    leads:[...(prev.leads || []), ...leads].slice(-MAX_LEADS),
  };
}

async function search(key, query) {
  requireBaiduQuota('trace-drafts');
  const response = await fetch(SEARCH_URL, {
    method:'POST', headers:{ 'X-Appbuilder-Authorization':`Bearer ${key}`, 'Content-Type':'application/json' },
    body:JSON.stringify({ messages:[{ content:query, role:'user' }], search_source:'baidu_search_v2', resource_type_filter:[{ type:'web', top_k:50 }] }),
    signal:AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`http_${response.status}: ${(await response.text().catch(() => '')).slice(0, 120)}`);
  const payload = await response.json();
  return Array.isArray(payload?.references) ? payload.references : [];
}

// 最近一轮抓取（30 小时内）整理出的“提到库里已有赛事”清单
export function loadLatestMentions(runsDir = path.join(HERE, 'runs'), now = Date.now()) {
  try {
    const dirs = fs.readdirSync(runsDir).filter(name => /^\d{4}-\d{2}-\d{2}T/.test(name)).sort().reverse();
    for (const dir of dirs) {
      const file = path.join(runsDir, dir, 'known-event-mentions.json');
      if (!fs.existsSync(file)) continue;
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Date.parse(data.createdAt) > now - 30 * 3600000 ? data.groups || [] : [];
    }
  } catch { /* 没有就算了 */ }
  return [];
}

async function call(token, body) {
  const response = await fetch(API, { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ adminToken:token, ...body }) });
  const result = await response.json();
  if (!result.ok) throw new Error(result.message || 'adminData_failed');
  return result.data;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const beijingDate = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const planFile = argv.includes('--plan') ? path.resolve(argv[argv.indexOf('--plan') + 1]) : path.join(HERE, 'plans', `search-plan-${beijingDate}.json`);
  if (!fs.existsSync(planFile)) { console.log(`没有计划文件 ${planFile}，跳过`); return; }
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const targets = plan.trace?.drafts || [];
  const mentions = loadLatestMentions();
  if (!targets.length && !mentions.length) { console.log('计划里没有需要追溯的记录，也没有抓取中提到的已有赛事'); return; }

  const token = fs.readFileSync(path.join(HERE, '.admin-token'), 'utf8').trim();
  const key = fs.readFileSync(path.join(HERE, '.baidu-search-key'), 'utf8').trim();
  const snapshot = await call(token, { action:'bootstrap' });
  const byId = new Map(snapshot.records.map(record => [record.id, record]));
  const now = new Date();
  const results = [];
  let quotaExhausted = false;
  for (const target of targets) {
    const record = byId.get(target.recordId);
    if (!record) { results.push({ ...target, skipped:'记录已不存在' }); continue; }
    if (quotaExhausted) { results.push({ ...target, skipped:'当日搜索额度已用完' }); continue; }
    let references = [];
    let error = null;
    try { references = await search(key, target.query); }
    catch (err) { error = err.message; if (/http_429/.test(error)) quotaExhausted = true; }
    if (quotaExhausted && error) { results.push({ ...target, skipped:'当日搜索额度已用完' }); continue; }
    const leads = error ? [] : pickLeads(references, record, now);
    results.push({ ...target, references:references.length, leads:leads.map(lead => lead.url), error, task:nextTask(record, { query:target.query, leads, error }, now) });
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // 抓取中提到的已有赛事：闲置额度按赛事名追溯；其余只挂通知和摘要里的网址
  const mentionResults = [];
  const searched = new Set(targets.map(target => target.recordId));
  const recent = record => Date.parse(record.task?.lastAttemptAt || '') > now.getTime() - 3 * 86400000;
  const budget = Math.max(0, Number(plan.unused) || 0);
  const searchTargets = mentionSearchTargets(mentions, mentions.length)
    .filter(({ record }) => byId.has(record.id) && !searched.has(record.id) && !recent(byId.get(record.id)))
    .slice(0, budget);
  const searchIds = new Set(searchTargets.map(({ record }) => record.id));
  for (const group of mentions) {
    const target = searchTargets.find(item => item.group === group);
    const recordId = target?.record.id || [...group.records].sort((a, b) => (a.status === 'quarantined') - (b.status === 'quarantined'))[0]?.id;
    const record = byId.get(recordId);
    if (!record) continue;
    const known = new Set([...(record.sources || []).map(source => source.url), ...(record.task?.leads || []).map(lead => lead.url)]);
    const free = noticeLeads(group, now).filter(lead => !known.has(lead.url) && known.add(lead.url));
    if (target && searchIds.has(record.id) && !quotaExhausted) {
      const query = `${String(record.name).replace(/[（(][^）)]*[）)]/g, '').trim()} ${new Date(now.getTime() + 8 * 3600000).getUTCFullYear()}`;
      let references = [];
      let error = null;
      try { references = await search(key, query); }
      catch (err) { error = err.message; if (/http_429/.test(error)) quotaExhausted = true; }
      const found = error ? [] : pickLeads(references, { ...record, task:{ ...(record.task || {}), leads:[...(record.task?.leads || []), ...free] } }, now);
      // 通知摘要里直接写出的网址最准，排最前；其次搜索找到的；提到它的通知本身放最后
      const leads = [...free.filter(lead => lead.source === '通知摘要'), ...found, ...free.filter(lead => lead.source !== '通知摘要')];
      mentionResults.push({ recordId:record.id, name:record.name, status:record.dataStatus, reason:'抓取中提到的已有赛事', query, references:references.length, leads:leads.map(lead => lead.url), error,
        task:nextTask(record, { query, leads, error }, now) });
      await new Promise(resolve => setTimeout(resolve, 500));
    } else if (free.length) {
      const prev = record.task || {};
      mentionResults.push({ recordId:record.id, name:record.name, status:record.dataStatus, reason:'抓取中提到的已有赛事（未搜索）', leads:free.map(lead => lead.url),
        task:{ ...prev, lastMentionAt:now.toISOString(), leads:[...(prev.leads || []), ...free].slice(-MAX_LEADS) } });
    }
  }

  const reportFile = path.join(HERE, 'plans', `trace-drafts-${beijingDate}${dryRun ? '-dry-run' : ''}.json`);
  fs.writeFileSync(reportFile, JSON.stringify({ at:now.toISOString(), planFile, results:results.map(({ task, ...rest }) => rest),
    mentions:mentionResults.map(({ task, ...rest }) => rest) }, null, 2));
  const updates = new Map([...results, ...mentionResults].filter(item => item.task).map(item => [item.recordId, item.task]));
  console.log(`追溯 ${targets.length} 条：搜索 ${results.filter(item => item.task && !item.error).length}，找到线索 ${results.filter(item => item.leads?.length).length}，失败 ${results.filter(item => item.error).length}，跳过 ${results.filter(item => item.skipped).length}`);
  console.log(`抓取中提到的已有赛事 ${mentions.length} 场：用闲置额度搜索 ${mentionResults.filter(item => item.query).length} 场，挂上线索 ${mentionResults.filter(item => item.leads.length).length} 场`);
  if (dryRun || !updates.size) return;

  // 写库前重新取一次，只合并 task 字段；版本冲突时重试一次。
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const fresh = await call(token, { action:'bootstrap' });
    const records = fresh.records.map(record => updates.has(record.id) ? { ...record, task:updates.get(record.id) } : record);
    try {
      const saved = await call(token, {
        action:'saveRecords', records, expectedVersion:fresh.stateVersions.records,
        auditEntry:{ id:`trace-drafts-${Date.now()}`, action:'update', objectType:'event_edition', recordId:'batch',
          recordName:`记录追溯：${updates.size} 条写入处理任务`, changedFields:['task'], actor:'super_admin',
          reason:'按次日搜索计划追溯当届官方通知，并追溯抓取中提到的已有赛事；只记录尝试与待核验线索，不改事实字段', createdAt:new Date().toISOString() },
      });
      console.log('saved version', saved.version, '报告', reportFile);
      return;
    } catch (err) {
      if (attempt || !/version|conflict/i.test(err.message)) throw err;
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
