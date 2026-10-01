// 赛事排序。
//
// 为什么不用级联排序（先按报名状态、再按推荐等级、最后按价值分）：
// 级联等于只有第一个关键词真正生效 —— 一场「即将报名 + 强烈推荐 + 目标完全匹配」
// 的赛事，会被一场「报名中 + 谨慎报名 + 完全不匹配」的压在下面。
// 第二关键词只在第一关键词打平时才有机会说话，这在赛事场景里几乎不会发生。
//
// 这里改成三步：
//   1. 硬过滤   —— 不该出现的直接剔除（已截止、已停办），不是降权
//   2. 加权打分 —— 各维度归一到 [0,1] 后加权求和，任何一维都可以影响结果
//   3. 多样性重排 —— 避免前十条全是同一专业的赛事
//
// 权重是当前的判断，不是定论：没有真实点击数据之前无法验证。
// 它们集中写在这里、可被测试固定，就是为了将来能按数据调整而不用翻遍代码。

const { MAX_VALUE_SCORE, RECOGNITION_PATHS, valueScores } = require('./competitionValue.js');

const WEIGHTS = {
  goalMatch:0.28,       // 目标路径/岗位上的认可度 —— 最重要，这是「含金量」
  recommendation:0.18,  // 人工/AI 的推荐等级
  urgency:0.18,         // 报名窗口紧迫度（相对窗口长度，不是绝对天数）
  opportunity:0.14,     // 机会窗口：首届赛事、短报名期 —— 不抢就错过的那类
  professionMatch:0.12, // 专业匹配
  accessibility:0.06,   // 参与门槛
  completeness:0.04,    // 信息完整度：资料不全的不该排在前面
};

const RECOMMENDATION_SCORE = { '强烈推荐':1, '值得参加':0.8, '适合练手':0.6, '高难挑战':0.5, '谨慎报名':0.2 };
// 没评过级（库里写着默认的“信息不足”或为空）按中间分：原先算 0 分，137 条公开比赛里 116 条因此全被排到后面（2026-10-01）
const UNRATED_RECOMMENDATION_SCORE = 0.5;

const DAY_MS = 24 * 60 * 60 * 1000;

const SHORT_WINDOW_DAYS = 14; // 报名期短于两周：容易还没听说就已经截止
// 官方日期的可靠度决定紧迫度下限：提醒用户「现在就去查本校安排」。
// 「确定由学校决定」比「不知道怎么组织」更急，但后者同样不能当成可靠。
const TIMING_URGENCY_FLOOR = { school_controlled:0.75, unverified:0.6, official:0 };
const SCHOOL_TIMING_URGENCY_FLOOR = TIMING_URGENCY_FLOOR.school_controlled;

// 报名窗口总长度。缺开始时间时返回 null，调用方退回绝对天数判断。
function registrationWindowDays(item) {
  if (!item.registration_start || !item.registration_end) return null;
  const span = (new Date(item.registration_end).getTime() - new Date(item.registration_start).getTime()) / DAY_MS;
  return Number.isFinite(span) && span > 0 ? span : null;
}

// 紧迫度必须相对窗口长度，不能只看绝对天数。
//
// 「剩 3 天」对两类赛事含义完全不同：
//   报名期 90 天的赛事剩 3 天  —— 用户拖到最后，多半准备不及
//   报名期  7 天的赛事剩 3 天  —— 这就是它的正常节奏，完全来得及
// 按绝对天数一刀切，会把短窗口的新赛事压下去，而那恰恰是最容易错过的一类。
function urgencyScore(item, now) {
  if (item.registration_status === '时间待公布') return 0.3;
  if (item.registration_status === '即将报名') return 0.6;
  if (!item.registration_end) return 0.5;
  const daysLeft = (new Date(item.registration_end).getTime() - now.getTime()) / DAY_MS;
  if (!Number.isFinite(daysLeft)) return 0.5;
  if (daysLeft < 0) return 0;

  const windowDays = registrationWindowDays(item);
  if (windowDays !== null && windowDays <= SHORT_WINDOW_DAYS) {
    // 短窗口赛事：只要还没截止就应当排在前面，因为再不看就没了。
    return daysLeft <= 1 ? 0.85 : 1;
  }
  let score;
  if (daysLeft <= 3) score = windowDays !== null && daysLeft / windowDays >= 0.2 ? 0.9 : 0.6;
  else if (daysLeft <= 21) score = 1;     // 黄金窗口
  else if (daysLeft <= 60) score = 0.75;
  else score = 0.45;

  // 官方日期不一定是可执行日期：校内选拔往往早几周到几个月，学校可能早就组织完了。
  // 官方还剩 60 天时显示「不紧急」是错的 —— 校赛很可能正好在这段时间进行。
  // 这里只抬到一个下限，不是加分：本来就紧迫的不受影响。
  const floor = TIMING_URGENCY_FLOOR[item.timing_reliability]
    ?? (item.school_timing_dependent ? SCHOOL_TIMING_URGENCY_FLOOR : 0);
  return Math.max(score, floor);
}

// 机会窗口：不抢就错过的那一类。
//
// 首届赛事必然没有历史认可度，goalMatch 一定是 0 —— 如果不单独给它一个维度，
// 「刚办、知道的人少、奖励丰厚」这类赛事会被结构性地埋在列表底部，
// 而这正是用户最需要雷达替他发现的。
//
// 但首届本身不是优点：水赛也全是首届。所以只有在有主办方背书或实质回报时才加分。
function opportunityScore(item) {
  let score = 0.4; // 常规赛事的基准，不惩罚也不奖励
  const highlights = Array.isArray(item.reward_highlights) ? item.reward_highlights : [];
  const substantive = highlights.some(value => value !== '现金奖金' && value !== '实物奖品' && value !== '证书荣誉');
  const recognized = Array.isArray(item.recognition) && item.recognition.some(claim => claim && (claim.level === '高' || claim.level === '中'));
  const richReward = Number(item.reward_amount) >= 50000 || item.reward_tier === '10万-50万' || item.reward_tier === '50万以上';
  const backed = substantive || recognized || richReward;

  if (item.lifecycle === '首届' && backed) score += 0.3;
  const windowDays = registrationWindowDays(item);
  if (windowDays !== null && windowDays <= SHORT_WINDOW_DAYS && backed) score += 0.3;
  return Math.min(score, 1);
}

function goalMatchScore(item, query) {
  const path = RECOGNITION_PATHS.includes(query.targetPath) ? query.targetPath : '';
  const scope = String(query.targetScope || '').trim();
  // 缓存里的 value_scores 是不限岗位的版本；用户指定岗位后按 recognition 重算。
  const scores = scope
    ? valueScores({
      recognition:item.recognition, rewardHighlights:item.reward_highlights,
      scaleTier:item.scale_tier, rewardAmount:item.reward_amount, rewardTier:item.reward_tier,
    }, { scope })
    : (item.value_scores && typeof item.value_scores === 'object' ? item.value_scores : {});
  const values = path
    ? [Number(scores[path]) || 0]
    : Object.values(scores).map(Number).filter(Number.isFinite);
  const best = values.length ? Math.max(0, ...values) : 0;
  return best / MAX_VALUE_SCORE;
}

function professionMatchScore(item, query) {
  const professions = Array.isArray(item.professions) ? item.professions : [];
  if (!professions.length) return 0;
  if (query.profession) return professions.includes(query.profession) ? 1 : 0;
  const wanted = Array.isArray(query.userProfessions) ? query.userProfessions : [];
  if (!wanted.length) return 0.5; // 用户没表达偏好，不加分也不惩罚
  return wanted.some(value => professions.includes(value)) ? 1 : 0.2;
}

// 门槛低 = 更多用户真的报得上，冷门赛事往往也更好进。
function accessibilityScore(item) {
  let score = 0.4;
  if (item.fee_type === '免费') score += 0.3;
  if (item.registration_organization === '自行报名') score += 0.2;
  if (item.scale_tier === '千人以下') score += 0.1;
  return Math.min(score, 1);
}

// 资料残缺的记录排在前面会浪费用户点击，也掩盖了待补的数据缺口。
const COMPLETENESS_FIELDS = ['participants', 'eligibility', 'format_and_rules', 'team_size', 'registration_method', 'fees', 'rewards', 'participant_scale'];
function completenessScore(item) {
  const filled = COMPLETENESS_FIELDS.filter(field => String(item[field] || '').trim()).length;
  const hasSchedule = item.registration_start && item.registration_end ? 1 : 0;
  return (filled + hasSchedule) / (COMPLETENESS_FIELDS.length + 1);
}

// 返回 0..1，越大越靠前。把每一维都留在结果里，便于排查「为什么这条排第一」。
function relevance(item, query = {}, now = new Date()) {
  const parts = {
    goalMatch:goalMatchScore(item, query),
    recommendation:RECOMMENDATION_SCORE[item.recommendation] ?? UNRATED_RECOMMENDATION_SCORE,
    urgency:urgencyScore(item, now),
    opportunity:opportunityScore(item),
    professionMatch:professionMatchScore(item, query),
    accessibility:accessibilityScore(item),
    completeness:completenessScore(item),
  };
  const score = Object.entries(WEIGHTS).reduce((sum, [key, weight]) => sum + weight * parts[key], 0);
  return { score, parts };
}

// 距离"能报名"还有多少天，统一口径给筛选和按时间排序共用：
// 报名中 —— 现在就能报，记 0（最紧迫）；
// 即将报名 —— 用官方公布的报名开始时间；
// 已归档 —— 用推算的下一届时间（按上一届节奏推算，不是官方信息，见 archiveSchedule.js）；
// 其余（时间待公布等）无法判断，返回 null，调用方要把 null 当"排除在外/排最后"处理。
function daysUntilNextRegistration(item, now = new Date()) {
  if (item.registration_status === '报名中') return 0;
  const target = item.data_status === 'archived'
    ? item.next_edition_estimate
    : item.registration_status === '即将报名' ? item.registration_start : null;
  if (!target) return null;
  const diff = (new Date(target).getTime() - now.getTime()) / DAY_MS;
  return Number.isFinite(diff) ? diff : null;
}

// 两条赛事有多像：共同的专业方向和目标标签越多越像。
function similarity(a, b) {
  const setOf = item => new Set([...(item.professions || []), ...(item.objective_tags || [])]);
  const left = setOf(a);
  const right = setOf(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const value of left) if (right.has(value)) shared += 1;
  return shared / (left.size + right.size - shared); // Jaccard
}

// MMR：每次挑「相关度高，且与已选结果不太像」的一条。
// 没有这一步，前十条很容易全是计算机类赛事，其他专业的用户翻不到自己的。
const DIVERSITY_LAMBDA = 0.78; // 偏向相关性；越小越强调多样性
const DIVERSITY_POOL = 60;     // 只对靠前的候选做 O(n²) 重排

function diversify(scored, lambda = DIVERSITY_LAMBDA) {
  const pool = scored.slice(0, DIVERSITY_POOL);
  const rest = scored.slice(DIVERSITY_POOL);
  const selected = [];
  while (pool.length) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    for (let i = 0; i < pool.length; i += 1) {
      const maxSimilarity = selected.reduce((max, chosen) => Math.max(max, similarity(pool[i].item, chosen.item)), 0);
      const value = lambda * pool[i].score - (1 - lambda) * maxSimilarity;
      if (value > bestValue) { bestValue = value; bestIndex = i; }
    }
    selected.push(pool.splice(bestIndex, 1)[0]);
  }
  return selected.concat(rest);
}

// 按"距离能报名还有多久"排序，query.sortOrder === 'desc' 时最远的排最前，
// 否则（含默认）最近的排最前。时间未知的记录（时间待公布等）永远排在最后，
// 不参与升降序——放前面或后面都是误导，不如老实垫底。
function sortByTime(items, query = {}, now = new Date()) {
  const withTime = items.map(item => ({ item, days:daysUntilNextRegistration(item, now) }));
  const known = withTime.filter(entry => entry.days !== null);
  const unknown = withTime.filter(entry => entry.days === null);
  const sign = query.sortOrder === 'desc' ? -1 : 1;
  known.sort((a, b) => sign * (a.days - b.days) || String(a.item.name || '').localeCompare(String(b.item.name || ''), 'zh-CN'));
  return [...known, ...unknown].map(entry => entry.item);
}

// 打分 + 重排。稳定性由名称兜底，保证同分时顺序可复现。
//
// query.sortBy / query.sortOrder 是用户在"更多筛选"里主动选的排序方式——
// 一旦选了，要的是可预测的确定顺序，多样性重排（diversify）这种"智能打散"
// 反而是噪声，所以这时候跳过它；什么都没选时走原来的默认智能排序，不受影响。
function rankRecords(items, query = {}, now = new Date()) {
  if (query.sortBy === 'time') return sortByTime(items, query, now);
  const explicitSort = Boolean(query.sortBy || query.sortOrder);
  const desc = query.sortOrder !== 'asc';
  const scored = items
    .map(item => ({ item, ...relevance(item, query, now) }))
    .sort((a, b) => (desc ? b.score - a.score : a.score - b.score) || String(a.item.name || '').localeCompare(String(b.item.name || ''), 'zh-CN'));
  if (explicitSort) return scored.map(entry => entry.item);
  return (query.diversify === false ? scored : diversify(scored)).map(entry => entry.item);
}

module.exports = {
  WEIGHTS, RECOMMENDATION_SCORE, DIVERSITY_LAMBDA, DIVERSITY_POOL,
  SHORT_WINDOW_DAYS, SCHOOL_TIMING_URGENCY_FLOOR, TIMING_URGENCY_FLOOR, registrationWindowDays, urgencyScore, opportunityScore,
  goalMatchScore, professionMatchScore, accessibilityScore, completenessScore,
  daysUntilNextRegistration, relevance, similarity, diversify, sortByTime, rankRecords,
};
