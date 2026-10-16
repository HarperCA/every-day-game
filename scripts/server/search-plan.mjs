// 次日搜索计划：把每天的搜索额度按三条路线分配，每条查询附上理由。
//
// 额度（2026-09-24 用户确定 60/25/15）：
//   追溯线索与主办方监测 60%：一部分留给抓取流水线里的通知追溯，其余给“缺当届官方原文”的草稿和待审记录，
//                            用赛事全名找当届通知，结果挂到记录上作线索（trace-drafts.mjs 执行）。
//   覆盖空白 25%：按专业搜索。2026-10-11 起改用教育部 2026 年本科专业目录的 883 个细分专业轮换（planMajorQueries）：
//                 原先十几个大类词（法学、材料科学……）天天重复搜，28 天 259 次只出了 7 条；细分专业更容易搜到学会、行业办的小众比赛。
//   新词试探 15%：只用已核验来源里出现过、库里还没有的赛事名（目前是四省立项目录），不自己造词。
// 连续两次零候选的查询暂停，冷却期 2、4、8……天（上限 32 天），到期自动恢复，不永久封死。
//
// 用法：node search-plan.mjs [--date 2026-09-25] [--budget 45]
// 产出：plans/search-plan-<北京日期>.json；冷却状态存 plans/search-plan-state.json
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ROUTES, ROUTE_SHARE } from './discovery.mjs';
import { professionQuery } from './search-baidu.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLAN_DIR = path.join(HERE, 'plans');
const STATE_FILE = path.join(PLAN_DIR, 'search-plan-state.json');
// 千帆免费额度约每天 50 次。2026-10-10 用户定：自动任务每天最多 30 次（search-engines.mjs 的共享计数硬性拦住），剩下 20 次留给测试。
// 同日再定：30 次全部给细分专业（覆盖空白）。通知追溯代理、补读正式通知改用 Kimi 搜索，记录追溯和新词试探不再分百度额度。
export const DEFAULT_BUDGET = 30;
export const ALL_TO_MAJORS = true;
// 通知追溯代理的百度份额（2026-10-10 起为 0，代理只用 Kimi 搜索）
export const NOTICE_FOLLOWUP_CALLS = 0;
const MAX_QUERY_BYTES = 72; // 接口限制：查询最长 72 字节，汉字算 2。

// 专业关键词 → 库里的十三类专业大类（“综合/不限专业”不参与覆盖空白）。
export const PROFESSION_CATEGORY = {
  计算机:'计算机与AI', 软件工程:'计算机与AI', 人工智能:'计算机与AI', 网络安全:'计算机与AI', 数据科学:'计算机与AI',
  电子信息:'电子信息', 通信工程:'电子信息', 电气工程:'电子信息',
  自动化:'机械与自动化', 机械工程:'机械与自动化', 机器人工程:'机械与自动化',
  土木工程:'建筑与土木', 建筑学:'建筑与土木', 城乡规划:'建筑与土木',
  化学工程:'材料与化工', 材料科学:'材料与化工',
  环境工程:'能源与环境', 能源与动力工程:'能源与环境',
  生物工程:'生物与医药', 临床医学:'生物与医药', 药学:'生物与医药', 农学:'生物与医药', 食品科学:'生物与医药',
  金融学:'经管与商科', 会计学:'经管与商科', 工商管理:'经管与商科',
  法学:'人文与法学', 新闻传播:'人文与法学',
  英语:'外语与教育', 翻译:'外语与教育', 师范教育:'外语与教育',
  工业设计:'设计与艺术', 视觉传达设计:'设计与艺术',
  数学建模:'数学与统计', 统计学:'数学与统计',
};

export function queryBytes(text) {
  let bytes = 0;
  for (const ch of String(text)) bytes += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  return bytes;
}

function fitQuery(core, suffix) {
  let text = String(core).trim();
  while (text && queryBytes(`${text} ${suffix}`) > MAX_QUERY_BYTES) text = text.slice(0, -1);
  return `${text} ${suffix}`.trim();
}

// 名称归一：去掉年份、届次、引号和空白，用于判断目录里的赛事库里有没有。
export function normalizeName(name) {
  return String(name || '')
    .replace(/(?:19|20)\d{2}(?:[—–~～至-](?:19|20)\d{2})?年?/g, '')
    .replace(/第[零〇一二三四五六七八九十百千万两\d]+届/g, '')
    .replace(/[“”"'‘’「」《》()（）\s·•・]/g, '')
    .replace(/(?:竞赛|大赛|比赛|挑战赛)$/, '');
}

export function allocate(budget, share = ROUTE_SHARE) {
  const trace = Math.round(budget * share[ROUTES.trace]);
  const gap = Math.round(budget * share[ROUTES.gap]);
  return { [ROUTES.trace]:trace, [ROUTES.gap]:gap, [ROUTES.probe]:Math.max(0, budget - trace - gap) };
}

const paused = (state, query, now) => {
  const until = Date.parse(state.queries?.[query]?.pausedUntil || '');
  return Number.isFinite(until) && until > now.getTime();
};

// 需要追溯当届官方原文的记录：分诊待追溯、立项目录导入、通知未解析、或没有有效官方来源。
export function needsEditionTrace(record) {
  if (!['draft', 'pending_system_validation', 'pending_manual_review'].includes(record.dataStatus)) return false;
  const issues = (record.qualityIssues || []).join('；');
  const official = (record.sources || []).some(source => source.is_official && source.validity_status === 'valid'
    && !['discovery_notice', 'university_notice', 'search_candidate', 'competition_directory'].includes(source.source_type));
  return record.triage?.bucket === '需要追溯' || /directory/i.test(String(record.ruleVersion || ''))
    || /notice_resolution_pending/.test(issues) || !official;
}

// 查询里不带括号说明，给赛事名本身留出长度。
const searchName = name => String(name || '').replace(/[（(][^）)]*[）)]/g, '').trim();

export function planTraceTargets(records, count, now) {
  return records
    .filter(record => needsEditionTrace(record))
    .filter(record => !(Date.parse(record.task?.nextCheckAt || '') > now.getTime()))
    .sort((a, b) => (Date.parse(a.triage?.traceDue || '') || Infinity) - (Date.parse(b.triage?.traceDue || '') || Infinity)
      || (a.task?.attempts || 0) - (b.task?.attempts || 0) || String(a.name).localeCompare(String(b.name), 'zh'))
    .slice(0, Math.max(0, count))
    .map(record => ({
      recordId:record.id, name:record.name, route:ROUTES.trace,
      query:fitQuery(`${searchName(record.name)} ${record.editionYear || now.getFullYear()}`, '通知 报名'),
      reason:record.triage?.traceTodo ? `分诊待追溯（期限 ${String(record.triage.traceDue || '').slice(0, 10)}）：${record.triage.traceTodo.slice(0, 40)}`
        : /directory/i.test(String(record.ruleVersion || '')) ? '只有立项目录，找当届正式通知' : '缺当届官方来源',
    }));
}

// 细分专业轮换（2026-10-11 起，用户定）：词库是 majors-2026.json（教育部《普通高等学校本科专业目录（2026年）》，883 种专业）。
// 顺序（2026-10-10 用户定）：①门类在校生人数从少到多（教育部 2022 年《普通本科分学科门类学生数》；交叉学科今年新设、没有统计，排最前）；
// ②同一门类里先搜今年新增的专业，再搜带“T”的特设专业，最后是基本专业；③再按专业代码。每个专业一次搜索。
// 搜过的 30 天内不再搜（不管搜索那一步有没有候选——原先按“候选”冷却，大类词每次都有候选、永远不停）。
export const MAJOR_REPEAT_DAYS = 30;
let majorsCache = null;
export function loadMajors(file = path.join(HERE, 'majors-2026.json')) {
  if (!majorsCache) majorsCache = readJson(file, { majors:[] }).majors || [];
  return majorsCache;
}
export const majorQuery = (name, year) => fitQuery(`${String(name).trim()} 大学生 竞赛`, `${year} 报名`);
const majorTier = major => major.new2026 ? 0 : /T/.test(major.code) ? 1 : 2;
const TIER_LABEL = ['今年新增', '特设专业', '基本专业'];
export function orderMajors(majors) {
  const enrol = major => (major.gateEnrollment === null || major.gateEnrollment === undefined ? -1 : major.gateEnrollment);
  return [...majors].sort((a, b) => enrol(a) - enrol(b) || majorTier(a) - majorTier(b) || a.code.localeCompare(b.code));
}
export function planMajorQueries(majors, count, state, now, year) {
  const cutoff = now.getTime() - MAJOR_REPEAT_DAYS * 86400000;
  const picked = [];
  for (const major of orderMajors(majors)) {
    if (picked.length >= count) break;
    const query = majorQuery(major.name, year);
    const at = Date.parse(state.queries?.[query]?.lastRunAt || '') || 0;
    if (at >= cutoff || paused(state, query, now) || picked.some(item => item.query === query)) continue;
    picked.push({ route:ROUTES.gap, query, major:major.name, majorCode:major.code, majorClass:major.cls, gate:major.gate,
      reason:`细分专业“${major.name}”（${major.gate}·${major.cls}，代码 ${major.code}，${TIER_LABEL[majorTier(major)]}；门类在校生 ${major.gateEnrollment ?? '无统计'}）：${at ? `上次搜索 ${new Date(at).toISOString().slice(0, 10)}` : '从未搜过'}` });
  }
  return picked;
}

// 旧的大类词挑法（2026-10-11 起不再使用，保留给对比和测试）
export function planGapQueries(records, count, state, now, year) {
  const covered = Object.fromEntries([...new Set(Object.values(PROFESSION_CATEGORY))].map(category => [category, 0]));
  for (const record of records) {
    if (!['published', 'archived'].includes(record.dataStatus)) continue;
    for (const profession of record.professions || []) if (profession in covered) covered[profession] += 1;
  }
  const lastRun = keyword => Date.parse(state.queries?.[professionQuery(keyword, year)]?.lastRunAt || '') || 0;
  const pool = Object.keys(PROFESSION_CATEGORY)
    .map(keyword => ({ keyword, category:PROFESSION_CATEGORY[keyword], query:professionQuery(keyword, year) }))
    .filter(item => !paused(state, item.query, now))
    .sort((a, b) => covered[a.category] - covered[b.category] || lastRun(a.keyword) - lastRun(b.keyword) || a.keyword.localeCompare(b.keyword, 'zh'));
  // 同一大类一轮最多两条，避免额度全压在一个大类上。
  const picked = [];
  const perCategory = {};
  for (const item of pool) {
    if (picked.length >= count) break;
    if ((perCategory[item.category] || 0) >= 2) continue;
    perCategory[item.category] = (perCategory[item.category] || 0) + 1;
    picked.push({ route:ROUTES.gap, query:item.query, category:item.category,
      reason:`“${item.category}”已发布及归档 ${covered[item.category]} 条，在各大类中偏少` });
  }
  return picked;
}

// scopeOk：收录范围规则（服务器上用 cjs/competitionScope.js）。立项目录本身就是高校学生竞赛目录，
// 这里只借它筛掉展演、目录、报道这类非比赛标题，不据此写入任何字段。
export function planProbeQueries(records, directoryEntries, count, state, now, scopeOk = () => true) {
  const known = records.map(record => normalizeName(record.name)).filter(Boolean);
  const seen = new Set();
  const picked = [];
  for (const entry of directoryEntries) {
    if (picked.length >= count) break;
    const core = normalizeName(entry.name);
    if (!core || core.length < 4 || seen.has(core)) continue;
    seen.add(core);
    if (known.some(name => name.includes(core) || core.includes(name))) continue;
    // 分站、选拔赛是上级赛事的环节，不作为新赛事去试。
    if (/选拔/.test(entry.name) || !scopeOk(entry.name)) continue;
    const query = fitQuery(String(entry.name).replace(/(?:19|20)\d{2}年?/g, '').trim(), '2026 通知 报名');
    if (paused(state, query, now) || state.queries?.[query]?.lastRunAt) continue; // 试过的新词不重复试，除非冷却后恢复
    picked.push({ route:ROUTES.probe, query, name:entry.name, reason:`${entry.list}立项目录列有该赛事（${String(entry.org || '承办单位未列').slice(0, 20)}），库里还没有` });
  }
  return picked;
}

// 用最近一次运行的逐条查询结果更新冷却状态：零候选累计两次起暂停 2^(n-1) 天。
export function updateCooldown(state, perQuery, now) {
  const next = { queries:{ ...(state.queries || {}) } };
  for (const item of perQuery || []) {
    const prev = next.queries[item.query] || { zeroStreak:0 };
    const zeroStreak = item.candidates > 0 ? 0 : (prev.zeroStreak || 0) + 1;
    const pauseDays = zeroStreak >= 2 ? Math.min(32, 2 ** (zeroStreak - 1)) : 0;
    next.queries[item.query] = { zeroStreak, lastRunAt:now.toISOString(), lastCandidates:item.candidates,
      pausedUntil:pauseDays ? new Date(now.getTime() + pauseDays * 86400000).toISOString() : null };
  }
  return next;
}

export function buildPlan({ records, directoryEntries, state, now, budget = DEFAULT_BUDGET, ledger = null, scopeOk, majors = null }) {
  const year = now.getFullYear();
  const quota = ALL_TO_MAJORS ? { [ROUTES.trace]:NOTICE_FOLLOWUP_CALLS, [ROUTES.gap]:budget - NOTICE_FOLLOWUP_CALLS, [ROUTES.probe]:0 } : allocate(budget);
  const traceTargets = planTraceTargets(records, quota[ROUTES.trace] - NOTICE_FOLLOWUP_CALLS, now);
  const gap = planMajorQueries(majors || loadMajors(), quota[ROUTES.gap], state, now, year);
  const probe = planProbeQueries(records, directoryEntries, quota[ROUTES.probe], state, now, scopeOk);
  return {
    date:now.toISOString(), budget, share:ROUTE_SHARE, quota,
    trace:{ noticeFollowups:NOTICE_FOLLOWUP_CALLS, drafts:traceTargets },
    search:[...gap, ...probe],
    unused:budget - NOTICE_FOLLOWUP_CALLS - traceTargets.length - gap.length - probe.length,
    ledger:ledger ? ledger.routes.map(({ route, calls, qualified, score, scorePerCall }) => ({ route, calls, qualified, score, scorePerCall })) : null,
  };
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function loadDirectoryEntries(dir) {
  const labels = { fujian:'福建省', guangdong:'广东省', hunan:'湖南省', jiangsu:'江苏省' };
  return Object.entries(labels).flatMap(([key, list]) => (readJson(path.join(dir, `curation-200-${key}-list.json`), []) || [])
    .map(item => ({ name:item.name, org:item.org, list })));
}

function latestRun(runsDir) {
  const names = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter(name => /^\d{4}-\d{2}-\d{2}T/.test(name)).sort() : [];
  for (const name of names.reverse()) {
    const report = readJson(path.join(runsDir, name, 'baidu-candidates.json'), null);
    if (report) return { name, report };
  }
  return null;
}

async function main() {
  const argv = process.argv.slice(2);
  const budget = Number(argv[argv.indexOf('--budget') + 1]) || DEFAULT_BUDGET;
  const now = argv.includes('--date') ? new Date(`${argv[argv.indexOf('--date') + 1]}T00:30:00+08:00`) : new Date();
  const beijingDate = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  fs.mkdirSync(PLAN_DIR, { recursive:true });

  let state = readJson(STATE_FILE, { queries:{}, appliedRuns:[] });
  const run = latestRun(path.join(HERE, 'runs'));
  if (run && !(state.appliedRuns || []).includes(run.name)) {
    const failed = new Set((run.report.failures || []).map(item => item.query));
    state = { ...updateCooldown(state, (run.report.perQuery || []).filter(item => !failed.has(item.query)), now), appliedRuns:[...(state.appliedRuns || []), run.name].slice(-60) };
  }

  const token = fs.readFileSync(path.join(HERE, '.admin-token'), 'utf8').trim();
  const response = await fetch('http://127.0.0.1:8787/api/adminData', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ adminToken:token, action:'bootstrap' }) });
  const result = await response.json();
  if (!result.ok) throw new Error(result.message || 'bootstrap_failed');
  const ledgerFile = fs.readdirSync(path.join(HERE, 'reports')).filter(name => /^route-ledger-\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort().pop();
  const ledger = ledgerFile ? readJson(path.join(HERE, 'reports', ledgerFile), null) : null;

  const { classifyCompetitionScope } = createRequire(import.meta.url)(path.join(HERE, 'cjs', 'competitionScope.js'));
  const scopeOk = name => classifyCompetitionScope({ name, participants:'高等学校在校学生' }).decision !== 'reject';
  const plan = buildPlan({ records:result.data.records, directoryEntries:loadDirectoryEntries(HERE), state, now, budget, ledger, scopeOk });
  const out = path.join(PLAN_DIR, `search-plan-${beijingDate}.json`);
  fs.writeFileSync(out, JSON.stringify(plan, null, 2));
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`额度 ${budget}：追溯 ${plan.quota[ROUTES.trace]}（通知追溯 ${NOTICE_FOLLOWUP_CALLS} + 记录追溯 ${plan.trace.drafts.length}）｜覆盖空白 ${plan.search.filter(q => q.route === ROUTES.gap).length}｜新词试探 ${plan.search.filter(q => q.route === ROUTES.probe).length}｜未用 ${plan.unused}`);
  console.log(`计划：${out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
