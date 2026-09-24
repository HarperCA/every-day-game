// 主办方公告栏监测：不花搜索额度，直接定期打开已核验赛事的主办方页面，比对有没有新通知。
// 属于“追溯线索与主办方监测”路线。
//
// 监测哪些页面：
//   1. 记录里标为主办方官网、官方报名系统的来源页；
//   2. 主办方通知、主管部门通知所在的上一级栏目（如 …/tzgg/2026-09/xxx.html → …/tzgg/2026-09/），
//      第一次打开时确认是列表页（至少 5 个站内链接）才纳入，否则记为不可监测。
// 每轮最多 MAX_PAGES 个页面，按上次检查时间轮换；抓取遵守 robots.txt，同站限速（crawler/lib/fetcher.mjs）。
//
// 发现什么：
//   - 标题像赛事通知、且含被监测赛事名称主体的新链接 → 作为待核验线索挂到那条记录的 task.leads
//     （已归档赛事出现新通知，多半是下一届开始了）；
//   - 其余像赛事通知的新链接 → 只写进报告作新赛事线索，不入库。
// 只写 task 字段，不改事实与状态。第一次看到某页时只把标题含当年或下一年的链接当作新线索，其余记为已见，避免一次涌入旧通知。
//
// 用法：node organizer-watch.mjs [--dry-run] [--max-pages 60]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeName } from './search-plan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(HERE, 'plans', 'organizer-watch-state.json');
const API = 'http://127.0.0.1:8787/api/adminData';
const MAX_PAGES = 60;
const MAX_SEEN_PER_PAGE = 400;
const WATCH_STATUSES = new Set(['published', 'archived', 'pending_manual_review', 'pending_system_validation', 'draft']);
const NOISY_HOSTS = /(^|\.)(mp\.weixin\.qq\.com|weixin\.qq\.com|baidu\.com|zhihu\.com|bilibili\.com|sohu\.com|163\.com|qq\.com|sina\.com\.cn)$/;
const NOTICE_TITLE = /通知|公告|章程|报名|启动|举办|征集|竞赛规程|实施方案/;
const CONTEST_TITLE = /竞赛|大赛|挑战赛|比赛|赛事|联赛|锦标赛|创新赛|邀请赛/;

const DEAD_STATUSES = new Set(['http_404', 'http_410', 'blocked_by_robots', 'unsupported_type', 'invalid_url', 'unsupported_protocol']);
const hostOf = url => { try { return new URL(url).hostname; } catch { return ''; } };

// 通知文章所在的上一级栏目。
export function parentListing(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return `${u.origin}/${parts.slice(0, -1).join('/')}/`;
  } catch { return null; }
}

export function watchPages(records) {
  const pages = new Map();
  const add = (url, record, kind) => {
    if (!url || NOISY_HOSTS.test(hostOf(url))) return;
    if (!pages.has(url)) pages.set(url, { url, kind, records:[] });
    const page = pages.get(url);
    if (!page.records.some(item => item.id === record.id)) page.records.push({ id:record.id, name:record.name });
  };
  for (const record of records) {
    if (!WATCH_STATUSES.has(record.dataStatus)) continue;
    for (const source of record.sources || []) {
      if (!source.is_official || source.validity_status !== 'valid' || !/^https?:\/\//.test(source.url || '')) continue;
      if (['organizer_website', 'official_registration_system'].includes(source.source_type)) add(source.url, record, 'site');
      else if (['organizer_notice', 'authority_notice'].includes(source.source_type)) add(parentListing(source.url), record, 'listing');
    }
  }
  return [...pages.values()];
}

const decodeEntities = text => text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));

export function extractLinks(html, baseUrl) {
  const out = [];
  const seen = new Set();
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(String(html || '')))) {
    const href = /href\s*=\s*["']([^"'#]+)["']/i.exec(match[1])?.[1];
    if (!href || /^(javascript|mailto):/i.test(href)) continue;
    const titleAttr = /title\s*=\s*["']([^"']+)["']/i.exec(match[1])?.[1] || '';
    const text = decodeEntities(match[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const title = (titleAttr.length > text.length ? decodeEntities(titleAttr) : text).trim();
    let url;
    try { url = new URL(href, baseUrl).href; } catch { continue; }
    if (!/^https?:/.test(url) || seen.has(url) || !title) continue;
    seen.add(url);
    out.push({ url, title:title.slice(0, 150) });
  }
  return out;
}

export const isContestNotice = title => NOTICE_TITLE.test(title) && CONTEST_TITLE.test(title);

// 链接标题含赛事名主体（去掉年份届次、省份前缀后至少 4 个字）才算这条记录的线索。
export function matchRecord(title, watched) {
  for (const record of watched) {
    const core = normalizeName(record.name).replace(/^(?:全国|中国|[一-龥]{2,3}(?:省|市|自治区))/, '');
    if (core.length >= 4 && normalizeName(title).includes(core.slice(0, 12))) return record;
  }
  return null;
}

// 比对一页：返回新出现的赛事通知链接，以及更新后的已见集合。
// knownUrls：库里任何记录已有的来源与线索网址，不再当作新线索。
// library：全库记录；标题先对本页监测的记录，对不上再对全库（转载站常同时发多个赛事的通知）。
export function diffPage(page, links, pageState, now, knownUrls = new Set(), library = []) {
  const firstVisit = !pageState?.seen;
  const seen = new Set(pageState?.seen || []);
  const years = [now.getFullYear(), now.getFullYear() + 1].map(String);
  const fresh = [];
  for (const link of links) {
    if (seen.has(link.url)) continue;
    seen.add(link.url);
    if (!isContestNotice(link.title) || knownUrls.has(link.url)) continue;
    if (firstVisit && !years.some(year => link.title.includes(year))) continue;
    fresh.push({ ...link, record:matchRecord(link.title, page.records) || matchRecord(link.title, library) });
  }
  return { fresh, seen:[...seen].slice(-MAX_SEEN_PER_PAGE) };
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
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
  const maxPages = Number(argv[argv.indexOf('--max-pages') + 1]) || MAX_PAGES;
  const now = new Date();
  const { Fetcher } = await import('./crawler/lib/fetcher.mjs');
  const fetcher = new Fetcher({ cacheDir:null });
  const token = fs.readFileSync(path.join(HERE, '.admin-token'), 'utf8').trim();
  const snapshot = await call(token, { action:'bootstrap' });
  const state = readJson(STATE_FILE, { pages:{} });
  const library = snapshot.records.filter(record => WATCH_STATUSES.has(record.dataStatus)).map(record => ({ id:record.id, name:record.name }));
  const knownUrls = new Set(snapshot.records.flatMap(record => [
    ...(record.sources || []).flatMap(source => [source.url, source.final_url]),
    ...(record.task?.leads || []).map(lead => lead.url), record.registrationUrl, record.discoveryNoticeUrl,
  ]).filter(Boolean));
  const pages = watchPages(snapshot.records)
    .filter(page => state.pages[page.url]?.status !== 'not_listing')
    .sort((a, b) => (Date.parse(state.pages[a.url]?.lastCheckedAt || '') || 0) - (Date.parse(state.pages[b.url]?.lastCheckedAt || '') || 0))
    .slice(0, maxPages);

  const recordLeads = new Map();
  const newCompetitionLeads = [];
  const pageResults = [];
  for (const page of pages) {
    const response = await fetcher.get(page.url, { useCache:false });
    const prev = state.pages[page.url] || {};
    // 推出来的栏目地址不存在、robots 不允许或不是网页的，永久移出监测；其余失败下轮再试。
    if (DEAD_STATUSES.has(response.status) && (page.kind === 'listing' || response.status === 'blocked_by_robots')) {
      state.pages[page.url] = { status:'not_listing', lastCheckedAt:now.toISOString(), lastStatus:response.status };
      pageResults.push({ url:page.url, status:response.status, removed:true });
      continue;
    }
    if (response.status !== 'ok' || response.isBinary) {
      state.pages[page.url] = { ...prev, lastCheckedAt:now.toISOString(), lastStatus:response.status };
      pageResults.push({ url:page.url, status:response.status });
      continue;
    }
    const links = extractLinks(response.text, response.finalUrl || page.url);
    const sameSite = links.filter(link => hostOf(link.url) === hostOf(page.url));
    if (page.kind === 'listing' && !prev.seen && sameSite.length < 5) {
      state.pages[page.url] = { status:'not_listing', lastCheckedAt:now.toISOString(), lastStatus:'ok', links:sameSite.length };
      pageResults.push({ url:page.url, status:'not_listing' });
      continue;
    }
    const { fresh, seen } = diffPage(page, links, prev, now, knownUrls, library);
    state.pages[page.url] = { ...prev, status:'watching', seen, lastCheckedAt:now.toISOString(), lastStatus:'ok', lastNew:fresh.length };
    for (const item of fresh) {
      const lead = { url:item.url, title:item.title, summary:`主办方页面新出现：${page.url}`, foundAt:now.toISOString(), status:'待核验', source:'主办方公告栏' };
      if (item.record) {
        if (!recordLeads.has(item.record.id)) recordLeads.set(item.record.id, []);
        recordLeads.get(item.record.id).push(lead);
      } else newCompetitionLeads.push({ ...lead, watchPage:page.url, watchedFor:page.records.map(r => r.name).slice(0, 3) });
    }
    pageResults.push({ url:page.url, status:'ok', links:links.length, fresh:fresh.length });
  }

  const beijingDate = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const reportFile = path.join(HERE, 'plans', `organizer-watch-${beijingDate}.json`);
  fs.mkdirSync(path.dirname(reportFile), { recursive:true });
  fs.writeFileSync(reportFile, JSON.stringify({ at:now.toISOString(), pages:pageResults, recordLeads:Object.fromEntries(recordLeads), newCompetitionLeads }, null, 2));
  console.log(`监测页面 ${pages.length}：正常 ${pageResults.filter(p => p.status === 'ok').length}，非列表页 ${pageResults.filter(p => p.status === 'not_listing').length}，失败 ${pageResults.filter(p => !['ok', 'not_listing'].includes(p.status)).length}｜记录线索 ${[...recordLeads.values()].flat().length} 条（${recordLeads.size} 条记录）｜新赛事线索 ${newCompetitionLeads.length} 条`);
  console.log(`报告：${reportFile}`);
  if (dryRun) return;
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  if (!recordLeads.size) return;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const fresh = await call(token, { action:'bootstrap' });
    const records = fresh.records.map(record => {
      const leads = recordLeads.get(record.id);
      if (!leads) return record;
      const known = new Set((record.task?.leads || []).map(lead => lead.url));
      const merged = [...(record.task?.leads || []), ...leads.filter(lead => !known.has(lead.url))].slice(-10);
      return { ...record, task:{ ...(record.task || {}), leads:merged, lastWatchAt:now.toISOString() } };
    });
    try {
      const saved = await call(token, {
        action:'saveRecords', records, expectedVersion:fresh.stateVersions.records,
        auditEntry:{ id:`organizer-watch-${Date.now()}`, action:'update', objectType:'event_edition', recordId:'batch',
          recordName:`主办方公告栏监测：${recordLeads.size} 条记录新增待核验线索`, changedFields:['task'], actor:'super_admin',
          reason:'主办方页面出现新的赛事通知，只作为待核验线索记入处理任务，不改事实字段', createdAt:now.toISOString() },
      });
      console.log('saved version', saved.version);
      return;
    } catch (error) {
      if (attempt || !/version|conflict/i.test(error.message)) throw error;
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
