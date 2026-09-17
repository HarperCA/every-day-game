// 用百度 AI 搜索 API 发现新赛事——不是直接爬某个网站，而是问一个已经
// 有自己爬虫、自己索引的第三方"附近有什么"，我们从不直接碰任何目标网站
// 的服务器。这条路和天池/DataFountain 那种"针对单个网站写死接口"的路子
// 性质不同：不挑网站，理论上能覆盖任何公开网页，包括地方性赛事、企业
// 赛事这类没有专属平台、天池/DataFountain 都不会收录的冷门赛事。
//
// API：千帆平台"AI搜索"，POST https://qianfan.baidubce.com/v2/ai_search/web_search
// 免费额度 50 次/天，所以默认查询条数控制得比较克制，别一次把额度打光。
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
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KEY_FILE = path.join(HERE, '.baidu-search-key');
const SEARCH_URL = 'https://qianfan.baidubce.com/v2/ai_search/web_search';
const SOURCE_NAME = '百度AI搜索';

// 查询模板针对的正是"天池/DataFountain/赛氪这类聚合平台不会收录"的那几类：
// 地方性赛事、企业赞助赛事、刚办的首届赛事、校级选拔通知。
// 额度有限，条数保守；query 本身不带年份，运行时拼当前年份，不用每年改代码。
const QUERY_TEMPLATES = [
  '{year}年 大学生 竞赛 报名开始 新赛事',
  '{year} 企业赞助 大学生 挑战赛 报名通知',
  '{year} 首届 大学生 大赛 报名',
  '大学生 竞赛 校内选拔 通知 {year}',
];

// 摘要里完全没有竞赛相关词的，大概率是新闻回顾、政策解读一类噪音，
// 不值得占用一次 AI 抽取额度——真正"是不是一场有价值的赛事"这个判断
// 留给收录门槛，这里只做最便宜的预过滤。
const RELEVANCE_KEYWORDS = ['赛', '挑战赛', '竞赛', '大赛', '锦标赛', '选拔赛'];

// 天池、DataFountain、赛氪已经有专属抓取器，搜索结果里再出现这些域名
// 只会被判重打回 duplicate/likely_duplicate，白占一次额度——直接跳过。
const KNOWN_SOURCE_HOSTS = ['tianchi.aliyun.com', 'datafountain.cn', 'saikr.com'];

function parseArgs(argv) {
  const args = { queries: QUERY_TEMPLATES.length, out: '../../reports/baidu-search-candidates.json' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--queries') args.queries = Math.max(1, Math.min(QUERY_TEMPLATES.length, Number(argv[i + 1]) || 1));
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
  const queries = QUERY_TEMPLATES.slice(0, args.queries).map(template => template.replace('{year}', String(year)));

  console.log(`查询 ${queries.length} 条（当日免费额度 50 次，每条查询算 1 次）\n`);

  const seen = new Set();
  const allCandidates = [];
  const stats = { queries: queries.length, referencesTotal: 0, filteredOut: 0, knownSourceSkipped: 0, duplicateWithinRun: 0 };
  const failures = [];

  for (const query of queries) {
    console.log(`--- ${query} ---`);
    let references;
    try {
      references = await searchOnce(apiKey, query);
    } catch (error) {
      failures.push({ query, error: error instanceof Error ? error.message : String(error) });
      console.log(`  失败: ${error instanceof Error ? error.message : error}`);
      continue;
    }
    stats.referencesTotal += references.length;
    for (const reference of references) {
      const host = hostOf(reference?.url);
      if (KNOWN_SOURCE_HOSTS.some(known => host === known || host.endsWith(`.${known}`))) {
        stats.knownSourceSkipped += 1;
        continue;
      }
      if (!isRelevant(reference)) {
        stats.filteredOut += 1;
        continue;
      }
      const candidate = toCandidate(reference, query);
      if (!candidate.name || !candidate.detailUrl || seen.has(candidate.externalId)) {
        stats.duplicateWithinRun += 1;
        continue;
      }
      seen.add(candidate.externalId);
      allCandidates.push(candidate);
    }
    console.log(`  ${references.length} 条结果，累计候选 ${allCandidates.length} 条`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    source: SOURCE_NAME,
    api: SEARCH_URL,
    queries,
    policy: '仅填充标题/摘要/链接。奖金、参赛规模、报名时间、认可度、地域、生命周期一律留空，待 AI 抽取详情页正文与人工确认。候选不直接入库。',
    stats,
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
    + `不相关过滤 ${stats.filteredOut} 条，本轮内重复 ${stats.duplicateWithinRun} 条`);
  console.log(`最终候选 ${allCandidates.length} 条，写入 ${outPath}`);
  if (failures.length) console.log(`失败查询: ${JSON.stringify(failures)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => {
    console.error('搜索发现失败:', error.message);
    process.exit(1);
  });
}
