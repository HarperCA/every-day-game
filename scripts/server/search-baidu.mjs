// 用百度 AI 搜索 API 发现新赛事——不是直接爬某个网站，而是问一个已经
// 有自己爬虫、自己索引的第三方"附近有什么"，我们从不直接碰任何目标网站
// 的服务器。这条路和天池/DataFountain 那种"针对单个网站写死接口"的路子
// 性质不同：不挑网站，理论上能覆盖任何公开网页，包括地方性赛事、企业
// 赛事这类没有专属平台、天池/DataFountain 都不会收录的冷门赛事。
//
// API：千帆平台"AI搜索"，POST https://qianfan.baidubce.com/v2/ai_search/web_search
// 免费额度 50 次/天。2026-09-19 起默认跑 28 条查询模板（占约 56% 额度），
// 留出余量给手动补跑；不追求刚好用满 50。
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
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KEY_FILE = path.join(HERE, '.baidu-search-key');
const SEARCH_URL = 'https://qianfan.baidubce.com/v2/ai_search/web_search';
const SOURCE_NAME = '百度AI搜索';

// 查询模板针对的正是"天池/DataFountain/赛氪这类聚合平台不会收录"的那几类：
// 地方性赛事、企业赞助赛事、刚办的首届赛事、校级选拔通知。
// query 本身不带年份，运行时拼当前年份，不用每年改代码。
//
// 2026-09-19 教训：原来只有 6 条，且大多是"XX通知""校内选拔"这类泛化措辞——
// 这类词精确命中的往往是"学校自己转发上级赛事"的二手页面（比如"湖州学院
// 关于组织参加XX省大学生XX竞赛的通知"），页面主体讲的是"我校怎么组织"，
// 不会完整复述主办方资质链条，AI 抽取时收录门槛判定所需的权威信号
// （教育部/学会/组委会字样）自然就抽不满分——不是赛事不够格，是二手转发页
// 天生抽不出一手信源该有的权威表述。实测当天 20 条新候选、7 条成功抽取，
// 0 条自动收录，全部卡在这个原因。
//
// 调整方向：
//   1. 更多措辞明确指向"官方通知/官网/组委会"，而不是泛泛的"通知"——
//      偏向命中赛事自己的官网或教育部/教育厅原始发文，而不是学校转发页。
//   2. 按赛事门类拆分（设计/商科/语言/机器人/学科竞赛等），这类搜索天然
//      更容易命中赛事自己的官网（用户搜的是"这个赛事"，不是"我们学校"）。
//   3. "校内选拔"这类查询词继续保留但不再是主力——它们抽出来的候选大概率
//      还是会落进 review 队列，但那正是它们的价值所在：报名截止日期往往
//      比国赛早，漏了它学生看到的日期就是自己已经没资格用的日期，需要
//      人工确认后收录，不能因为「大概率进不了 admit」就不搜。
const QUERY_TEMPLATES = [
  // —— 一手信源优先：教育部/教育厅/官方目录 ——
  '教育部 关于举办 全国大学生 竞赛 通知 {year}',
  '教育厅 大学生 竞赛 通知 {year}',
  '{year}年 教育部 公布 大学生竞赛 名单',
  '全国大学生竞赛分析报告 {year} 竞赛目录',
  '{year} 学会 主办 大学生 竞赛 官网',
  '{year} 协会 主办 大学生 挑战赛 报名',
  '{year} 省级 大学生 学科竞赛 目录 公布',
  // —— 按门类拆分：搜的是赛事本身，更容易命中赛事官网而不是学校转发页 ——
  '{year} 大学生 人工智能 创新应用 大赛 官网',
  '{year} 大学生 设计大赛 官方报名',
  '{year} 大学生 创新创业大赛 官网 报名',
  '{year} 大学生 数学建模 竞赛 官方通知',
  '{year} 大学生 机器人 大赛 报名通知',
  '{year} 大学生 英语 演讲 竞赛 官方通知',
  '{year} 大学生 电子设计 竞赛 官网',
  '{year} 大学生 编程 算法 竞赛 报名',
  '{year} 大学生 商业 案例分析 大赛 官网',
  '{year} 大学生 文化创意 设计大赛 报名',
  '{year} 大学生 金融 科技 竞赛 报名通知',
  '{year} 大学生 生物医药 创新 大赛 报名',
  '{year} 大学生 环保 公益 创新大赛 报名',
  '{year} 大学生 短视频 摄影 大赛 官方通知',
  '{year} 大学生 广告 营销 创意大赛 报名',
  '{year} 大学生 建筑 规划 设计竞赛 报名',
  // —— 长尾发现：首届、企业命题、一般性新赛事 ——
  '{year} 首届 大学生 大赛 报名',
  '{year} 企业赞助 大学生 挑战赛 报名通知',
  '{year} 大学生 创新创业 大赛 企业命题 报名',
  '{year}年 大学生 竞赛 报名开始 新赛事',
  // —— 校内选拔：命中率低但不可替代，报名截止日期往往比国赛早 ——
  '大学生 竞赛 校内选拔 通知 {year}',
  '{year} 科技创新挑战赛 报名 官网',
  '{year} 全国高校 竞赛 报名截止 官方',
  '{year} 创新创业大赛 报名 10月 政府',
];

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

// 天池、DataFountain、赛氪已经有专属抓取器，搜索结果里再出现这些域名
// 只会被判重打回 duplicate/likely_duplicate，白占一次额度——直接跳过。
const KNOWN_SOURCE_HOSTS = ['tianchi.aliyun.com', 'datafountain.cn', 'saikr.com'];

function parseArgs(argv) {
  const args = { queries: QUERY_TEMPLATES.length, offset: 0, out: '../../reports/baidu-search-candidates.json' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--queries') args.queries = Math.max(1, Math.min(QUERY_TEMPLATES.length, Number(argv[i + 1]) || 1));
    if (argv[i] === '--offset') args.offset = Math.max(0, Math.min(QUERY_TEMPLATES.length - 1, Number(argv[i + 1]) || 0));
    if (argv[i] === '--out') args.out = argv[i + 1];
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

// 拿 URL 算一个稳定 id：同一条搜索结果重跑多次要落在同一条候选上，
// 而不是每次都当成新的重复写一遍——和其它来源"按 externalId 去重"的
// 纪律一致。不用外部哈希库，标准库 crypto 就够。
function stableIdFor(url) {
  return createHash('sha256').update(String(url)).digest('hex').slice(0, 16);
}

export function toCandidate(reference, query) {
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
    evidence: { source: SOURCE_NAME, url, api: SEARCH_URL, fields: [], fetchedAt: new Date().toISOString() },
    needsReview: ['organizer', 'reward_amount', 'participant_count', 'registration_start', 'registration_end', 'recognition', 'region', 'lifecycle', 'professions'],
  };
}

async function searchOnce(apiKey, query) {
  const response = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: { 'X-Appbuilder-Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ content: query, role: 'user' }],
      search_source: 'baidu_search_v2', // 必须带，否则可能不触发真实检索
      resource_type_filter: [{ type: 'web', top_k: 10 }],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`http_${response.status}: ${text.slice(0, 200)}`);
  }
  const payload = await response.json();
  return Array.isArray(payload?.references) ? payload.references : [];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = readKey();
  const year = new Date().getFullYear();
  const queries = QUERY_TEMPLATES.slice(args.offset, args.offset + args.queries).map(template => template.replace('{year}', String(year)));

  console.log(`查询 ${queries.length} 条（当日免费额度 50 次，每条查询算 1 次）\n`);

  const seen = new Set();
  const allCandidates = [];
  const stats = { queries: queries.length, referencesTotal: 0, filteredOut: 0, outOfScopeSkipped: 0, knownSourceSkipped: 0, duplicateWithinRun: 0 };
  // 每条查询单独记账。没有这份账，"某条查询常年 0 产出"只能靠人偶然发现——
  // 2026-09-21 那 7 条纯浪费的查询就是这么被漏了几个月的。
  const perQuery = new Map();
  const failures = [];

  for (const query of queries) {
    console.log(`--- ${query} ---`);
    const tally = { references: 0, outOfScope: 0, irrelevant: 0, duplicate: 0, candidates: 0 };
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
    for (const reference of references) {
      const host = hostOf(reference?.url);
      if (KNOWN_SOURCE_HOSTS.some(known => host === known || host.endsWith(`.${known}`))) {
        stats.knownSourceSkipped += 1;
        continue;
      }
      // 范围过滤放在相关性过滤之前：中小学/青少年/体育类标题往往同时含"大赛"，
      // 相关性关键词拦不住它们，必须靠收录范围判断。
      if (isOutOfScopeReference(reference)) {
        stats.outOfScopeSkipped += 1;
        tally.outOfScope += 1;
        continue;
      }
      if (!isRelevant(reference)) {
        stats.filteredOut += 1;
        tally.irrelevant += 1;
        continue;
      }
      const candidate = toCandidate(reference, query);
      if (!candidate.name || !candidate.detailUrl || seen.has(candidate.externalId)) {
        stats.duplicateWithinRun += 1;
        tally.duplicate += 1;
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
