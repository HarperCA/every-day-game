// 用百度 AI 搜索 API 发现新赛事——不是直接爬某个网站，而是问一个已经
// 有自己爬虫、自己索引的第三方"附近有什么"，我们从不直接碰任何目标网站
// 的服务器。这条路和天池/DataFountain 那种"针对单个网站写死接口"的路子
// 性质不同：不挑网站，理论上能覆盖任何公开网页，包括地方性赛事、企业
// 赛事这类没有专属平台、天池/DataFountain 都不会收录的冷门赛事。
//
// API：千帆平台"AI搜索"，POST https://qianfan.baidubce.com/v2/ai_search/web_search
// 官方文档当前标注该 web_search 接口每天免费 100 次；实际剩余额度以千帆控制台为准。
// 默认查询模板数以 QUERY_TEMPLATES 为准，留出余量给通知追溯和手动补跑。
//
// 部署位置：/opt/daily-contest/search-baidu.mjs
// 密钥：/opt/daily-contest/.baidu-search-key，单行纯文本，chmod 600
//       （"应用接入"页面生成的 bce-v3/ALTAK- 开头的密钥）
//
// 产出的候选和天池/DataFountain 那两个抓取脚本是同一种形状，能直接喂给
// 已有的 merge-candidates.mjs 判重、run-extract.mjs 抽取——搜索结果只给
// 标题、摘要、链接，奖金/人数/报名时间这些一律留空，交给后续 AI 抽取
// 详情页正文（已有的 extractFromDetailPage 通用抓取路径会自己去访问那个
// URL，并且照样走 robots.txt 检查，不会因为「来自搜索结果」就绕开）。
//
// 用法：node search-baidu.mjs [--queries 4] [--out ../../reports/baidu-search-candidates.json]
import { recordRawSearch } from './search-engines.mjs';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setDefaultResultOrder } from 'node:dns';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ROUTES } from './discovery.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 部署服务器到百度的 IPv6 路由不可用，Node fetch 默认选择后会 ETIMEDOUT；
// IPv4 连通性已验证。只影响本进程的域名解析顺序。
setDefaultResultOrder('ipv4first');
const KEY_FILE = path.join(HERE, '.baidu-search-key');
const SEARCH_URL = 'https://qianfan.baidubce.com/v2/ai_search/web_search';
const SOURCE_NAME = '百度AI搜索';
const WEB_RESULTS_PER_QUERY = 50; // 百度网页模态允许的最大值；计费按调用次数，不按返回条数。

// 按用户确定的「最近可报名的大学生 + 专业 + 竞赛」逐专业搜索。
// 搜索词只负责发现；是否仍可报名必须读取当届官方日期后核验。
export const PROFESSIONS = [
  '计算机', '软件工程', '人工智能', '网络安全', '数据科学',
  '电子信息', '通信工程', '自动化', '机械工程', '电气工程',
  '机器人工程', '土木工程', '建筑学', '城乡规划', '化学工程',
  '材料科学', '环境工程', '生物工程', '临床医学', '药学',
  '农学', '食品科学', '金融学', '会计学', '工商管理',
  '法学', '英语', '翻译', '新闻传播', '工业设计', '数学建模',
];
export const QUERY_TEMPLATES = PROFESSIONS.map(profession =>
  `{year} 最近可报名的大学生 ${profession} 专业竞赛 官网 报名入口`);
export const professionQuery = (profession, year) => `${year} 最近可报名的大学生 ${profession} 专业竞赛 官网 报名入口`;

// 有次日计划（search-plan.mjs）时按计划搜，每条查询带自己的路线；没有计划时退回固定的按专业查询。
export function queriesFromPlan(plan) {
  return (plan?.search || []).filter(item => item?.query && item?.route).map(item => ({ query:String(item.query), route:String(item.route) }));
}

// 2026-09-22 删除的 7 条查询，连同删除理由一并记下来，避免以后有人"补全门类"
// 时再加回去：
//   '{year} 全国中学生 竞赛 报名 官方通知'
//   '{year} 青少年 体育赛事 报名 官方通知'
//   '{year} 青少年科技创新大赛 报名'
//   '{year} 体育锦标赛 报名 截止 官方通知'
//   '{year} 文化艺术 大赛 报名 政府网站'
//   '{year} 全国职业技能大赛 报名公告'
//   '{year} 省级职业技能竞赛 报名 通知'
//
// 这 7 条搜的正是 competitionScope.js 的 OUT_OF_SCOPE 正则（中小学|青少年|
// 全民健身|男子飞盘…）专门要拒的类别——发现层在主动找过滤层保证会丢弃的东西。
// 2026-09-21 那次抓取的实测：这 7 条共产出 68 条候选，eligible 0 条，
// 却照样消耗了 7 次百度额度 + 68 次判重 + 相应的 AI 抽取开销。
// 历史上删掉的 34 条 out-of-scope 记录（魔方巡回赛、男子飞盘公开赛、
// 全民健身走跑赛、帕克球巡回赛、无线电测向）也都是从这几条查询进来的。
//
// 要重新加回任何一条，先改 competitionScope.js 的收录范围，否则只是
// 再造一次同样的浪费。

// 摘要里完全没有竞赛相关词的，大概率是新闻回顾、政策解读一类噪音，
// 不值得占用一次 AI 抽取额度——真正"是不是一场有价值的赛事"这个判断
// 留给收录门槛，这里只做最便宜的预过滤。
const RELEVANCE_KEYWORDS = ['赛', '挑战赛', '竞赛', '大赛', '锦标赛', '选拔赛'];

// 范围过滤前移到搜索结果这一层，用的是入库闸 requireScopeForNewRecords 同一个
// 模块——不复制一份正则。之所以强调"同一个模块"：发现层和过滤层各写各的规则，
// 正是 2026-09-21 之前那批 out-of-scope 记录的成因（查询搜体育赛事、入库闸拒
// 体育赛事，两边谁也不知道对方在干什么）。共用模块后，改收录范围只需改一处。
//
// 这里只拦 isClearlyOutOfScope（中小学/青少年/体育/兴趣类），不拦通知标题：
// 通知页是合法线索——SLA 明确"通知可以作为正式证据，但记录名称必须是从中核验
// 出的具体比赛"，流水线也有 resolve-notice-leads.mjs 专门追溯通知里的真实赛事。
// 在源头砍掉通知会把这条线索通道一起砍断，属于误杀。
// 模块位置在仓库和服务器上不一样：仓库里是 apps/miniprogram/cloudfunctions/adminData/，
// 服务器上 sync-extract.sh 把它拍平同步到 <部署目录>/cjs/。ingest-candidates.mjs
// 只写死了服务器那条路径——它是纯服务器脚本，测试从不 import 它，所以没暴露问题；
// 本文件有单元测试（tests/search-baidu.test.mjs）会在仓库里 import，写死哪一条都会断。
function requireScopeModule() {
  const require = createRequire(import.meta.url);
  const candidates = [
    path.join(HERE, 'cjs', 'competitionScope.js'),                                      // 服务器部署布局
    path.join(HERE, '..', '..', 'apps', 'miniprogram', 'cloudfunctions', 'adminData', 'competitionScope.js'), // 仓库布局
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return require(file);
  }
  throw new Error(`找不到 competitionScope.js，已尝试：${candidates.join('、')}`);
}

const { isClearlyOutOfScope } = requireScopeModule();

export function isOutOfScopeReference(reference) {
  return isClearlyOutOfScope({ name: reference?.title || '' });
}

// 天池、赛氪已经有专属抓取器，搜索结果里再出现这些域名只会被判重打回，白占一次额度——直接跳过。
// DataFountain 2026-09-30 起整个来源停用（全是过期比赛和练习题），搜索结果里的也一样跳过，不从这条路绕回来。
const KNOWN_SOURCE_HOSTS = ['tianchi.aliyun.com', 'datafountain.cn', 'saikr.com'];

function parseArgs(argv) {
  const args = { queries: QUERY_TEMPLATES.length, offset: 0, out: '../../reports/baidu-search-candidates.json', plan: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--queries') args.queries = Math.max(1, Math.min(QUERY_TEMPLATES.length, Number(argv[i + 1]) || 1));
    if (argv[i] === '--offset') args.offset = Math.max(0, Math.min(QUERY_TEMPLATES.length - 1, Number(argv[i + 1]) || 0));
    if (argv[i] === '--out') args.out = argv[i + 1];
    if (argv[i] === '--plan') args.plan = argv[i + 1];
  }
  return args;
}

function readKey() {
  if (!fs.existsSync(KEY_FILE)) throw new Error(`缺少密钥文件 ${KEY_FILE}`);
  const key = fs.readFileSync(KEY_FILE, 'utf8').trim();
  if (!key) throw new Error(`密钥文件 ${KEY_FILE} 是空的，请先写入`);
  return key;
}

export function hostOf(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function isRelevant(reference) {
  const text = `${reference?.title || ''} ${reference?.content || ''}`;
  return RELEVANCE_KEYWORDS.some(keyword => text.includes(keyword));
}

// 一条搜索结果在脚本内的去向：丢弃（附原因）或成为候选。丢弃的也要逐条留档，
// 否则“不相关”一类只剩数字，无从判断规则是不是太严（2026-09-26：550 条里 208 条被判不相关却看不到是哪些）。
export const DROP_REASONS = {
  known_source: '已有专门抓取器的平台', out_of_scope: '不在收录范围', irrelevant: '标题和摘要都不含“赛”字', duplicate: '同一轮已出现或缺标题网址',
};
export function screenReference(reference, query, route, seenIds) {
  const host = hostOf(reference?.url);
  if (KNOWN_SOURCE_HOSTS.some(known => host === known || host.endsWith(`.${known}`))) return { reason:'known_source' };
  // 范围过滤放在相关性过滤之前：中小学/青少年/体育类标题往往同时含"大赛"，
  // 相关性关键词拦不住它们，必须靠收录范围判断。
  if (isOutOfScopeReference(reference)) return { reason:'out_of_scope' };
  if (!isRelevant(reference)) return { reason:'irrelevant' };
  const candidate = toCandidate(reference, query, route);
  if (!candidate.name || !candidate.detailUrl || seenIds.has(candidate.externalId)) return { reason:'duplicate' };
  return { candidate };
}

export function droppedEntry(reference, query, route, reason) {
  return { query, route, reason, reasonText:DROP_REASONS[reason], title:String(reference?.title || '').trim().slice(0, 150),
    url:String(reference?.url || ''), snippet:String(reference?.content || '').trim().slice(0, 160) };
}

// 拿 URL 算一个稳定 id：同一条搜索结果重跑多次要落在同一条候选上，
// 而不是每次都当成新的重复写一遍——和其它来源"按 externalId 去重"的
// 纪律一致。不用外部哈希库，标准库 crypto 就够。
function stableIdFor(url) {
  return createHash('sha256').update(String(url)).digest('hex').slice(0, 16);
}

// 当前固定的按专业查询属于“覆盖空白”路线；以后由次日计划给每条查询指定路线。
export const DEFAULT_ROUTE = ROUTES.gap;

export function toCandidate(reference, query, route = DEFAULT_ROUTE) {
  const url = String(reference?.url || '');
  return {
    externalId: `search-${stableIdFor(url)}`,
    name: String(reference?.title || '').trim(),
    seriesName: null,
    detailUrl: url,
    introduction: String(reference?.content || '').trim().slice(0, 2000),
    tags: [],

    // 搜索摘要给不出结构化数字，一律留空——奖金、人数、报名时间都要靠
    // 后续 AI 抽取详情页正文来定，和 DataFountain 对报名时间的处理是同一个道理，
    // 只是这里连"大概是不是报名区间"这点线索都没有，更不能编。
    organizer: '', reward_amount: null, reward_tier: '暂未公布', reward_highlights: [], rewards: '',
    participant_count: null, participant_unit: '暂未公布', scale_tier: '暂未公布', participant_scale: '',
    registration_start: null, registration_end: null, competition_start: null, competition_end: null,
    recognition: [],
    region: '',
    lifecycle: '暂未明确',

    matchedQuery: query,
    discovery: { route, query, source: SOURCE_NAME },
    evidence: { source: SOURCE_NAME, url, api: SEARCH_URL, fields: [], fetchedAt: new Date().toISOString() },
    needsReview: ['organizer', 'reward_amount', 'participant_count', 'registration_start', 'registration_end', 'recognition', 'region', 'lifecycle', 'professions'],
  };
}

async function searchOnce(apiKey, query) {
  const request = () => fetch(SEARCH_URL, {
    method: 'POST',
    headers: { 'X-Appbuilder-Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ content: query, role: 'user' }],
      search_source: 'baidu_search_v2', // 必须带，否则可能不触发真实检索
      resource_type_filter: [{ type: 'web', top_k: WEB_RESULTS_PER_QUERY }],
    }),
    signal: AbortSignal.timeout(20000),
  });
  let response;
  try { response = await request(); }
  catch (error) {
    // 仅传输层失败时重试一次；HTTP 错误不重复消耗搜索额度。
    await new Promise(resolve => setTimeout(resolve, 500));
    response = await request();
  }
  const raw = await response.text().catch(() => '');
  recordRawSearch('baidu-nightly', query, response.status, raw);
  if (!response.ok) throw new Error(`http_${response.status}: ${raw.slice(0, 200)}`);
  const payload = JSON.parse(raw);
  return Array.isArray(payload?.references) ? payload.references : [];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = readKey();
  const year = new Date().getFullYear();
  const planned = args.plan ? queriesFromPlan(JSON.parse(fs.readFileSync(args.plan, 'utf8'))) : [];
  const entries = planned.length ? planned
    : QUERY_TEMPLATES.slice(args.offset, args.offset + args.queries).map(template => ({ query:template.replace('{year}', String(year)), route:DEFAULT_ROUTE }));
  const queries = entries.map(item => item.query);
  const routeOf = new Map(entries.map(item => [item.query, item.route]));
  if (planned.length) console.log(`按次日计划搜索：${args.plan}`);

  console.log(`查询 ${queries.length} 条（官方当前标注每日免费 100 次；实际余额以控制台为准）\n`);

  const seen = new Set();
  const allCandidates = [];
  const stats = { queries: queries.length, referencesTotal: 0, filteredOut: 0, outOfScopeSkipped: 0, knownSourceSkipped: 0, duplicateWithinRun: 0 };
  // 每条查询单独记账。没有这份账，"某条查询常年 0 产出"只能靠人偶然发现——
  // 2026-09-21 那 7 条纯浪费的查询就是这么被漏了几个月的。
  const perQuery = new Map();
  const failures = [];
  const dropped = [];

  for (const query of queries) {
    console.log(`--- ${query} ---`);
    const tally = { route: routeOf.get(query) || DEFAULT_ROUTE, references: 0, outOfScope: 0, irrelevant: 0, duplicate: 0, candidates: 0 };
    perQuery.set(query, tally);
    let references;
    try {
      references = await searchOnce(apiKey, query);
    } catch (error) {
      failures.push({ query, error: error instanceof Error ? error.message : String(error) });
      console.log(`  失败: ${error instanceof Error ? error.message : error}`);
      continue;
    }
    stats.referencesTotal += references.length;
    tally.references = references.length;
    const route = routeOf.get(query) || DEFAULT_ROUTE;
    for (const reference of references) {
      const { reason, candidate } = screenReference(reference, query, route, seen);
      if (reason) {
        dropped.push(droppedEntry(reference, query, route, reason));
        if (reason === 'known_source') stats.knownSourceSkipped += 1;
        if (reason === 'out_of_scope') { stats.outOfScopeSkipped += 1; tally.outOfScope += 1; }
        if (reason === 'irrelevant') { stats.filteredOut += 1; tally.irrelevant += 1; }
        if (reason === 'duplicate') { stats.duplicateWithinRun += 1; tally.duplicate += 1; }
        continue;
      }
      seen.add(candidate.externalId);
      allCandidates.push(candidate);
      tally.candidates += 1;
    }
    console.log(`  ${references.length} 条结果 → 候选 ${tally.candidates} 条`
      + `（范围外 ${tally.outOfScope}、不相关 ${tally.irrelevant}、重复 ${tally.duplicate}），累计 ${allCandidates.length} 条`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    source: SOURCE_NAME,
    api: SEARCH_URL,
    queries,
    policy: '仅填充标题/摘要/链接。奖金、参赛规模、报名时间、认可度、地域、生命周期一律留空，待 AI 抽取详情页正文与人工确认。候选不直接入库。',
    stats,
    // 按候选产出升序：0 产出的查询排在最前面，下次跑完一眼就能看见该删谁。
    perQuery: [...perQuery.entries()]
      .map(([query, tally]) => ({ query, ...tally }))
      .sort((a, b) => a.candidates - b.candidates),
    failures,
    candidateCount: allCandidates.length,
    candidates: allCandidates,
    droppedCount: dropped.length,
    dropped,
  };

  // 默认值 '../../reports/…' 是按仓库里 scripts/server/ 的嵌套深度写的，
  // 部署到服务器后脚本是平铺放在 /opt/daily-contest/ 下面，同一个默认值
  // 会多跳一层——实测真的落到了文件系统根目录的 /reports/ 下面。和
  // crawl-tianchi.mjs/crawl-datafountain.mjs 同一个坑：两边路径深度不一样，
  // 没有一个相对默认值能同时对——所以服务器上调用务必显式传 --out
  // （run-crawl-pipeline.mjs 编排时已经是这么做的，这里手动跑也一样）。
  const outPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), args.out);
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await fsp.writeFile(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  console.log(`\n共拿到 ${stats.referencesTotal} 条原始结果，已知来源跳过 ${stats.knownSourceSkipped} 条，`
    + `范围外跳过 ${stats.outOfScopeSkipped} 条，不相关过滤 ${stats.filteredOut} 条，本轮内重复 ${stats.duplicateWithinRun} 条`);
  console.log(`最终候选 ${allCandidates.length} 条，写入 ${outPath}`);
  const barren = report.perQuery.filter(item => item.candidates === 0 && item.references > 0);
  if (barren.length) {
    console.log(`\n本轮 0 产出的查询 ${barren.length} 条（连续多轮 0 产出就该删掉，理由写进模板注释）：`);
    for (const item of barren) console.log(`  - ${item.query}（结果 ${item.references}，范围外 ${item.outOfScope}）`);
  }
  if (failures.length) console.log(`失败查询: ${JSON.stringify(failures)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => {
    console.error('搜索发现失败:', error.message);
    process.exit(1);
  });
}
