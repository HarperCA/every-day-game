// DataFountain 赛事抓取。
//
// 这个站没有独立的 JSON 接口（/api/ 也没暴露列表），列表页是 Nuxt SSR，
// 数据整段序列化在 `window.__NUXT__=(function(a,b,c,...){...})(实参...)` 里——
// 用参数名给重复出现的值去重，是 Nuxt 常见的编译输出，不是加密也不是混淆。
// 这段就是纯数据字面量（没有任何副作用调用），在隔离的 vm 沙箱里执行一次
// 取回结果对象，比正则硬解析更可靠，也不会引入任何页面脚本的副作用。
//
// 三条纪律，和天池抓取一致：
//   1. 只填能从列表数据事实读出的字段。这个站比天池多给一样东西——
//      organizers 数组里直接有主办方名字，可以不经 AI 直接填 organizer。
//   2. 报名时间不能直接拿 startTime/endTime：抽查详情页发现这两个字段是
//      「比赛整体周期」，真正的报名截止日期写在正文里（例如「4月X日报名截止」），
//      和天池的 signupStartTime/raceStartTime 分得清清楚楚不一样。这里为了
//      不编造，报名时间一律留空，交给后续 AI 抽取详情页正文来定。
//   3. 产出是候选文件，不直接写库。
//
// 没有 robots.txt（404），按项目里 robots.js 的既定策略（同 apps/miniprogram/
// cloudfunctions/adminData/robots.js 的注释）取不到时视为允许全站，与 Fetcher
// 的 loadRobots 行为一致。
//
// 用法：node crawl-datafountain.mjs [--pages 5] [--out ../../reports/datafountain-candidates.json]
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { Fetcher } from './lib/fetcher.mjs';
// valueSource.mjs 会自动在仓库路径和服务器部署路径之间选，见该文件头注释。
import { deriveRewardTier, deriveScaleTier } from './lib/valueSource.mjs';

const LIST_URL = page => `https://www.datafountain.cn/competitions?page=${page}`;
const DETAIL_URL = id => `https://www.datafountain.cn/competitions/${id}`;
const SOURCE_NAME = 'DataFountain';
const PAGE_SIZE = 30;

function parseArgs(argv) {
  const args = { pages: 5, out: '../../reports/datafountain-candidates.json' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--pages') args.pages = Math.max(1, Number(argv[i + 1]) || 1);
    if (argv[i] === '--out') args.out = argv[i + 1];
  }
  return args;
}

// 从 SSR 页面里把 window.__NUXT__ 赋值语句整段抠出来，在隔离沙箱里跑一次。
// 只暴露一个空的 window 对象，不给 require/fetch/process，跑的又是纯字面量，
// 没有能逃逸沙箱的路径。
export function extractNuxtBlock(html) {
  const start = html.indexOf('window.__NUXT__=');
  if (start < 0) return null;
  const scriptEnd = html.indexOf('</script>', start);
  if (scriptEnd < 0) return null;
  const code = html.slice(start, scriptEnd);
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  try {
    vm.runInContext(code, sandbox, { timeout: 5000 });
  } catch {
    return null;
  }
  return sandbox.window.__NUXT__?.data?.[0] || null;
}

// 每个填入的字段都带出处，便于事后复核。
function evidenceFor(id, fields) {
  return { source: SOURCE_NAME, url: DETAIL_URL(id), api: LIST_URL(1), fields, fetchedAt: new Date().toISOString() };
}

export function toCandidate(item) {
  const teams = Number.isFinite(Number(item.teams)) ? Number(item.teams) : null;
  // rewardType!==1 时 reward 字段不代表现金金额（实测出现过纯占位值），不可信，留空。
  const rewardAmount = item.rewardType === 1 && Number.isFinite(Number(item.reward)) ? Number(item.reward) : null;
  const organizer = (item.organizers || []).map(o => String(o?.name || '').trim()).filter(Boolean).join('、');

  return {
    externalId: `datafountain-${item.id}`,
    name: String(item.title || '').trim(),
    seriesName: null,
    detailUrl: DETAIL_URL(item.id),
    introduction: String(item.subTitle || '').trim().slice(0, 2000),
    tags: (item.tags || []).map(tag => tag?.nameCn).filter(Boolean),

    // —— 能从列表数据事实读出的字段 ——
    organizer,
    reward_amount: rewardAmount,
    reward_tier: deriveRewardTier(rewardAmount),
    reward_highlights: rewardAmount && rewardAmount > 0 ? ['现金奖金'] : [],
    rewards: rewardAmount && rewardAmount > 0 ? `奖金池 ${rewardAmount} 元（DataFountain 列表数据 reward 字段）` : '',
    participant_count: teams,
    participant_unit: teams === null ? '暂未公布' : '队',
    scale_tier: deriveScaleTier(teams),
    participant_scale: teams === null ? '' : `已报名 ${teams} 支队伍（抓取时点）`,
    // 见文件头第 2 条：startTime/endTime 是比赛整体周期，不是报名区间，不能直接当报名时间用。
    registration_start: null,
    registration_end: null,
    competition_start: null,
    competition_end: null,

    // —— 需要判断、列表数据给不了的字段：一律留空 ——
    recognition: [],
    region: '',
    lifecycle: '暂未明确',

    isOpenSignup: item.isOpenSignup === 1,
    evidence: evidenceFor(item.id, organizer ? ['organizer', 'reward_amount', 'participant_count'] : ['reward_amount', 'participant_count']),
    needsReview: ['registration_start', 'registration_end', 'recognition', 'reward_highlights（非现金部分）', 'region', 'lifecycle', 'professions'],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fetcher = new Fetcher({ cacheDir: null, timeoutMs: 20000 });
  const items = [];
  const failures = [];
  let total = null;

  for (let pageNum = 1; pageNum <= args.pages; pageNum += 1) {
    const url = LIST_URL(pageNum);
    const page = await fetcher.get(url, { useCache: false });
    if (page.status !== 'ok') {
      failures.push({ pageNum, status: page.status, error: page.error || null });
      break;
    }
    const block = extractNuxtBlock(page.text);
    if (!block || !Array.isArray(block.competitions)) {
      failures.push({ pageNum, status: 'nuxt_block_not_found', error: null });
      break;
    }
    total = Number.isFinite(block.total) ? block.total : total;
    items.push(...block.competitions);
    if (total !== null && pageNum * PAGE_SIZE >= total) break;
  }

  const seen = new Set();
  const allCandidates = [];
  for (const item of items) {
    const candidate = toCandidate(item);
    if (!candidate.name || seen.has(candidate.externalId)) continue;
    seen.add(candidate.externalId);
    allCandidates.push(candidate);
  }

  // 只保留报名尚未关闭的：已关闭的候选对「发现新赛事」这个目标没有价值，
  // 而且详情页正文这时往往已经改口风（成绩公示替换了报名说明），AI 抽取
  // 拿到的会是过期信息。
  const candidates = allCandidates.filter(item => item.isOpenSignup);

  const report = {
    generatedAt: new Date().toISOString(),
    source: SOURCE_NAME,
    listUrl: LIST_URL(1),
    policy: '仅填充列表数据可事实读出的字段。报名时间、认可度、非现金回报、地域、生命周期留空，待 AI 抽取详情页正文与人工确认。只保留报名未关闭的候选。候选不直接入库。',
    fetchStats: fetcher.stats,
    failures,
    totalOnSite: total,
    fetchedCount: allCandidates.length,
    openSignupCount: candidates.length,
    candidateCount: candidates.length,
    candidates,
  };

  const outPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), args.out);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  const withOrganizer = candidates.filter(item => item.organizer).length;
  const withReward = candidates.filter(item => item.reward_amount !== null).length;
  console.log(`抓到 ${allCandidates.length} 条，报名未关闭 ${candidates.length} 条，写入 ${outPath}`);
  console.log(`  有主办方: ${withOrganizer}/${candidates.length}   有奖金数值: ${withReward}/${candidates.length}`);
  console.log(`  抓取统计: ${JSON.stringify(fetcher.stats)}`);
  if (failures.length) console.log(`  失败分页: ${JSON.stringify(failures)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => {
    console.error('抓取失败:', error.message);
    process.exit(1);
  });
}
