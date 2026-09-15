// 把抓到的候选与库中已有赛事比对，产出待人工确认的合并清单。
//
// 不写库。产出分四类：
//   duplicate        规范化名称完全一致 —— 同一赛事，应该合并为新一届
//   likely_duplicate 高度相似 —— 很可能是同一赛事，需要确认
//   uncertain        有线索但不确定（同域名／中等相似）—— 必须人工或 AI 判断
//   new              库中没有相近的 —— 候选新赛事
//
// 用法：node merge-candidates.mjs [--candidates ../../reports/tianchi-candidates.json]
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyCandidates } from './lib/dedupe.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {
    candidates:'../../reports/tianchi-candidates.json',
    seed:'../../data/seed/competitions.json',
    out:'../../reports/merge-candidates.json',
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--candidates') args.candidates = argv[i + 1];
    if (argv[i] === '--seed') args.seed = argv[i + 1];
    if (argv[i] === '--out') args.out = argv[i + 1];
  }
  return args;
}

async function readJson(relative) {
  return JSON.parse(await fs.readFile(path.resolve(here, relative), 'utf8'));
}

// 把种子数据整理成判重需要的形状：标准名 + 别名 + 所有已知来源域名。
function buildMasters(seed) {
  const sourcesByEvent = new Map();
  const editionToEvent = new Map();
  for (const edition of seed.event_editions || []) editionToEvent.set(edition.id, edition.event_id);
  for (const source of seed.data_sources || []) {
    const eventId = editionToEvent.get(source.edition_id);
    if (!eventId) continue;
    if (!sourcesByEvent.has(eventId)) sourcesByEvent.set(eventId, []);
    sourcesByEvent.get(eventId).push(source.url);
  }
  return (seed.event_masters || []).map(master => ({
    id:master.id,
    standard_name:master.standard_name,
    aliases:master.aliases || [],
    website_url:master.website_url || '',
    sourceHosts:sourcesByEvent.get(master.id) || [],
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const candidateFile = await readJson(args.candidates);
  const seed = await readJson(args.seed);
  const candidates = candidateFile.candidates || [];
  const masters = buildMasters(seed);

  const buckets = classifyCandidates(candidates, masters);
  const masterName = id => masters.find(master => master.id === id)?.standard_name || null;

  const summarize = entries => entries.map(({ candidate, match }) => ({
    candidate:candidate.name,
    externalId:candidate.externalId,
    detailUrl:candidate.detailUrl,
    matchedMaster:masterName(match.matchedId),
    matchedId:match.matchedId,
    confidence:Number(match.confidence.toFixed(3)),
    reason:match.reason,
    // 新赛事才需要把抓到的数值带下去；重复项的数值应并入已有记录。
    values:match.verdict === 'new'
      ? { reward_amount:candidate.reward_amount, reward_tier:candidate.reward_tier, participant_count:candidate.participant_count, scale_tier:candidate.scale_tier }
      : undefined,
  }));

  const report = {
    generatedAt:new Date().toISOString(),
    candidateSource:candidateFile.source || args.candidates,
    candidateCount:candidates.length,
    masterCount:masters.length,
    policy:'只做规则能确定的判断。uncertain 一律交人工或 AI，不硬猜。产出不写库。',
    counts:Object.fromEntries(Object.entries(buckets).map(([key, value]) => [key, value.length])),
    duplicate:summarize(buckets.duplicate),
    likely_duplicate:summarize(buckets.likely_duplicate),
    uncertain:summarize(buckets.uncertain),
    new:summarize(buckets.new),
    invalid:summarize(buckets.invalid),
  };

  const outPath = path.resolve(here, args.out);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  console.log(`候选 ${candidates.length} 条 × 库中 ${masters.length} 个赛事`);
  for (const [key, value] of Object.entries(report.counts)) {
    if (value) console.log(`  ${key.padEnd(17)} ${value}`);
  }
  const needsHuman = report.counts.likely_duplicate + report.counts.uncertain;
  console.log(`需人工确认: ${needsHuman}   可直接作为新赛事候选: ${report.counts.new}`);
  console.log(`写入 ${outPath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => {
    console.error('合并失败:', error.message);
    process.exit(1);
  });
}
