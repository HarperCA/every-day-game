// 天池赛事抓取。
//
// 为什么走接口而不是解析页面：天池的列表页是前后端分离的，静态抓取只拿到 137 字
// 骨架（实测）。它背后的接口直接返回结构化字段，其中 bonus 和 teamCount 正是
// 「奖励」和「竞争强度」两个维度需要的数值 —— 不用 AI 抽取，也不用从 HTML 里猜。
//
// 两条纪律：
//   1. 只填能从接口事实读出的字段。认可度、面试绿卡这类判断留空，
//      交给后续的 AI 抽取和人工确认 —— 编造比留空有害得多。
//   2. 产出是候选文件，不直接写库。和 getPublishBlockers 的设计一致：
//      抓取只提建议，发布与否由人决定。
//
// 用法：node crawl-tianchi.mjs [--pages 3] [--out ../../reports/tianchi-candidates.json]
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Fetcher } from './lib/fetcher.mjs';
// 档位阈值与云函数共用同一份实现，避免抓取时和发布后落在不同档位。
// valueSource.mjs 会自动在仓库路径和服务器部署路径之间选，抓取脚本
// 部署到服务器单独运行时不用改这一行。
import { deriveRewardTier, deriveScaleTier } from './lib/valueSource.mjs';

const LIST_API = 'https://tianchi.aliyun.com/v3/proxy/competition/api/race/page';
const DETAIL_URL = raceId => `https://tianchi.aliyun.com/competition/entrance/${raceId}`;
const SOURCE_NAME = '阿里云天池';

function parseArgs(argv) {
  const args = { pages: 3, out: '../../reports/tianchi-candidates.json' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--pages') args.pages = Math.max(1, Number(argv[i + 1]) || 1);
    if (argv[i] === '--out') args.out = argv[i + 1];
  }
  return args;
}

// 接口返回的时间是 'YYYY-MM-DD HH:mm:ss'（北京时间），转成 ISO 存库。
export function toIso(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) return null;
  const parsed = new Date(text.replace(' ', 'T') + '+08:00');
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// 系列赛把赛道挂在 trackList 上，赛道才是真正可报名的单位。
export function flattenRaces(list) {
  const out = [];
  for (const race of list || []) {
    if (Array.isArray(race.trackList) && race.trackList.length) {
      for (const track of race.trackList) out.push({ ...track, seriesName: race.name });
    } else {
      out.push(race);
    }
  }
  return out;
}

// 每个填入的字段都带出处，便于事后复核 —— 没出处的字段不该进库。
function evidenceFor(raceId, fields) {
  return { source: SOURCE_NAME, url: DETAIL_URL(raceId), api: LIST_API, fields, fetchedAt: new Date().toISOString() };
}

export function toCandidate(race) {
  const bonus = Number.isFinite(Number(race.bonus)) ? Number(race.bonus) : null;
  const teamCount = Number.isFinite(Number(race.teamCount)) ? Number(race.teamCount) : null;
  // bonus 为 0 在天池是「确实没有现金奖」，不是「未知」，所以原样保留。
  const rewardHighlights = bonus && bonus > 0 ? ['现金奖金'] : [];

  return {
    externalId: `tianchi-${race.raceId}`,
    name: String(race.name || '').trim(),
    seriesName: race.seriesName || null,
    detailUrl: DETAIL_URL(race.raceId),
    introduction: String(race.introduction || '').trim().slice(0, 2000),
    tags: (race.tagsList || []).map(tag => tag.tagNameCn || tag.tagName).filter(Boolean),

    // —— 能从接口事实读出的字段 ——
    reward_amount: bonus,
    reward_tier: deriveRewardTier(bonus),
    reward_highlights: rewardHighlights,
    rewards: bonus && bonus > 0 ? `奖金池 ${bonus} 元（天池列表接口 bonus 字段）` : '',
    participant_count: teamCount,
    participant_unit: teamCount === null ? '暂未公布' : '队',
    scale_tier: deriveScaleTier(teamCount),
    participant_scale: teamCount === null ? '' : `已报名 ${teamCount} 支队伍（抓取时点）`,
    registration_start: toIso(race.signupStartTime),
    registration_end: toIso(race.signupEndTime),
    competition_start: toIso(race.raceStartTime),
    competition_end: toIso(race.raceEndTime),

    // —— 需要判断、接口给不了的字段：一律留空 ——
    // 认可度要看行业共识，面试绿卡要读详情页正文，都不是列表接口能回答的。
    recognition: [],
    region: '',
    lifecycle: '暂未明确',

    evidence: evidenceFor(race.raceId, ['reward_amount', 'participant_count', 'registration_start', 'registration_end']),
    needsReview: ['recognition', 'reward_highlights（非现金部分）', 'region', 'lifecycle', 'professions'],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fetcher = new Fetcher({ cacheDir: null, timeoutMs: 20000 });
  const races = [];
  const failures = [];

  for (let pageNum = 1; pageNum <= args.pages; pageNum += 1) {
    const url = `${LIST_API}?visualTab=&raceName=&pageNum=${pageNum}&isActive=`;
    const page = await fetcher.get(url, { useCache: false });
    if (page.status !== 'ok') {
      failures.push({ pageNum, status: page.status, error: page.error || null });
      break;
    }
    let payload;
    try {
      payload = JSON.parse(page.text);
    } catch (error) {
      failures.push({ pageNum, status: 'invalid_json', error: String(error.message).slice(0, 120) });
      break;
    }
    const list = payload?.data?.list || [];
    races.push(...flattenRaces(list));
    if (!payload?.data?.hasNextPage) break;
  }

  const seen = new Set();
  const candidates = [];
  for (const race of races) {
    const candidate = toCandidate(race);
    if (!candidate.name || seen.has(candidate.externalId)) continue;
    seen.add(candidate.externalId);
    candidates.push(candidate);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    source: SOURCE_NAME,
    listApi: LIST_API,
    policy: '仅填充接口可事实读出的字段。认可度、非现金回报、地域、生命周期留空，待 AI 抽取与人工确认。候选不直接入库。',
    fetchStats: fetcher.stats,
    failures,
    candidateCount: candidates.length,
    candidates,
  };

  const outPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), args.out);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  const filled = candidates.filter(item => item.reward_amount !== null).length;
  const scaled = candidates.filter(item => item.participant_count !== null).length;
  console.log(`抓到 ${candidates.length} 条候选，写入 ${outPath}`);
  console.log(`  有奖金数值: ${filled}/${candidates.length}   有参赛规模: ${scaled}/${candidates.length}`);
  console.log(`  抓取统计: ${JSON.stringify(fetcher.stats)}`);
  if (failures.length) console.log(`  失败分页: ${JSON.stringify(failures)}`);
}

// 作为模块导入时不执行抓取，便于单测纯函数。
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => {
    console.error('抓取失败:', error.message);
    process.exit(1);
  });
}
