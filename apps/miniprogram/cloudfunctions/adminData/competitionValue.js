// 赛事价值维度：奖励、参赛规模、地域、生命周期、分路径认可度。
//
// 存在的目的是回答：「冷门但高回报的赛事，怎么让用户看见」。
// 大赛人人都知道，不需要推荐；用户自己找不到的是小众但含金量高的那些。
//
// 两条核心设计原则：
//
// 一、含金量不等于奖金。
//    数学建模、ACM-ICPC 几乎没有现金奖金，但保研加分和企业认可度极高；
//    营销性质的商业赛可能开出五万奖金却没有含金量。
//    所以现金最多贡献 1 分，且只在赛事本身已有认可时才计入。
//
// 二、含金量是分路径、分岗位的，不是一个标量。
//    同一场赛事，考研导师认可、企业 HR 未必认可；即使同在求职路径上，
//    算法岗认可的赛事，产品岗也未必认可。
//    因此认可度按「保研考研 / 求职就业 / 出国留学 / 创业融资」分路径记录，
//    每条还可带 scope（具体岗位或方向）。scope 为空表示该路径下通用。
//    最终由用户的目标路径和岗位决定看哪个分数 —— 排序发生在查询层，不在缓存层。

const REWARD_TIERS = ['无现金奖励', '万元以下', '1万-10万', '10万-50万', '50万以上', '暂未公布'];
const REWARD_HIGHLIGHTS = ['保研考研加分', '实习或直通面试', '就业绿色通道', '创业扶持', '国际交流', '证书荣誉', '实物奖品', '现金奖金'];
const SCALE_TIERS = ['千人以下', '千人-1万', '1万-10万', '10万以上', '暂未公布'];
const PARTICIPANT_UNITS = ['队', '人', '暂未公布'];
const LIFECYCLES = ['长期举办', '首届', '不定期', '疑似停办', '已停办', '暂未明确'];
// 与 event_edition schema 的同名字段保持一致，抽取结果必须落在这几个值里。
const REGISTRATION_ORGANIZATIONS = ['自行报名', '学校统一报名', '两种方式均可', '需先校内选拔', '以赛区或学校通知为准', '暂未明确'];

const RECOGNITION_PATHS = ['保研考研', '求职就业', '出国留学', '创业融资'];
const RECOGNITION_LEVELS = ['高', '中', '低', '暂未明确'];
const LEVEL_SCORE = { '高':6, '中':3, '低':1, '暂未明确':0 };

// 非现金回报各自服务于不同路径：直通面试对求职有用，对保研没用。
const HIGHLIGHT_PATH = {
  '保研考研加分':'保研考研',
  '实习或直通面试':'求职就业',
  '就业绿色通道':'求职就业',
  '国际交流':'出国留学',
  '创业扶持':'创业融资',
};
const HIGHLIGHT_BONUS = 3;
const MAX_HIGHLIGHT_BONUS = 3;

// 参赛规模小 = 获奖概率高，但只有赛事本身已被认可时才算加分，
// 否则「没人参加的无名赛事」会被顶到最前面。
const SCARCITY_SCORE = { '千人以下':2, '千人-1万':1, '1万-10万':0, '10万以上':0, '暂未公布':0 };
const MAX_VALUE_SCORE = 9;

function normalizeEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function uniqueFrom(values, allowed) {
  if (!Array.isArray(values)) return [];
  const out = [];
  for (const value of values) {
    if (allowed.includes(value) && !out.includes(value)) out.push(value);
  }
  return out;
}

// 认可度条目必须带 evidence —— 没有出处的认可不可复核，直接丢弃。
function normalizeRecognition(values) {
  if (!Array.isArray(values)) return [];
  const byPath = new Map();
  for (const item of values) {
    if (!item || typeof item !== 'object') continue;
    const path = normalizeEnum(item.path, RECOGNITION_PATHS, null);
    const level = normalizeEnum(item.level, RECOGNITION_LEVELS, null);
    const evidence = String(item.evidence || '').slice(0, 300);
    if (!path || !level || !evidence) continue;
    // scope 为空 = 该路径下通用；非空 = 只对这些岗位/方向成立
    const scope = Array.isArray(item.scope)
      ? [...new Set(item.scope.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim().slice(0, 40)))].slice(0, 8)
      : [];
    const existing = byPath.get(path);
    // 同一路径出现多条时保留等级最高的一条
    if (!existing || LEVEL_SCORE[level] > LEVEL_SCORE[existing.level]) {
      byPath.set(path, { path, level, evidence, scope });
    }
  }
  return RECOGNITION_PATHS.filter(path => byPath.has(path)).map(path => byPath.get(path));
}

function cashNudge(amount, tier) {
  if (Number.isFinite(Number(amount)) && Number(amount) >= 100000) return 1;
  return tier === '10万-50万' || tier === '50万以上' ? 1 : 0;
}

// 每条路径一个分数。分越高越值得推荐。数据缺失时全为 0，不影响现有排序。
// scope 传入用户的目标岗位/方向：只有通用条目和命中该岗位的条目参与计分。
function valueScores(record = {}, { scope = '' } = {}) {
  const target = String(scope || '').trim();
  const recognition = normalizeRecognition(record.recognition)
    .filter(item => !item.scope.length || !target || item.scope.includes(target));
  const highlights = uniqueFrom(record.rewardHighlights, REWARD_HIGHLIGHTS);
  const scarcity = SCARCITY_SCORE[normalizeEnum(record.scaleTier, SCALE_TIERS, '暂未公布')] || 0;
  const cash = cashNudge(record.rewardAmount, record.rewardTier);

  const scores = {};
  for (const path of RECOGNITION_PATHS) {
    const recognized = recognition.find(item => item.path === path);
    const recognitionScore = recognized ? LEVEL_SCORE[recognized.level] : 0;
    const highlightScore = Math.min(
      highlights.filter(item => HIGHLIGHT_PATH[item] === path).length * HIGHLIGHT_BONUS,
      MAX_HIGHLIGHT_BONUS,
    );
    const base = recognitionScore + highlightScore;
    // 这条路径上没有任何实质价值，稀缺性和奖金都不该加分
    scores[path] = base ? Math.min(base + scarcity + cash, MAX_VALUE_SCORE) : 0;
  }
  return scores;
}

// 未指定路径时取最高分，用于「不确定目标」的用户和后台概览。
function bestValueScore(record = {}, options = {}) {
  return Math.max(0, ...Object.values(valueScores(record, options)));
}

// 档位由数值派生，阈值只此一份 —— 爬虫和云函数必须得出同一个档，
// 否则同一条数据在抓取时和发布后会落在不同档位上。
function deriveRewardTier(amount) {
  // null/undefined/'' 是「不知道」，0 是「明确没有现金奖励」，两者不能混。
  if (amount === null || amount === undefined || amount === '') return '暂未公布';
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return '暂未公布';
  if (value === 0) return '无现金奖励';
  if (value < 10000) return '万元以下';
  if (value < 100000) return '1万-10万';
  if (value < 500000) return '10万-50万';
  return '50万以上';
}

// 阈值按「参赛单位数」计，单位（队/人）另存在 participant_unit，
// 不做队→人的换算：每队几人因赛制而异，换算等于编造。
function deriveScaleTier(count) {
  if (count === null || count === undefined || count === '') return '暂未公布';
  const value = Number(count);
  if (!Number.isFinite(value) || value < 0) return '暂未公布';
  if (value < 1000) return '千人以下';
  if (value < 10000) return '千人-1万';
  if (value < 100000) return '1万-10万';
  return '10万以上';
}
// 有近一半的赛事（实测 14/30）报名时间实际由学校决定：校内选拔、学校统一报名、
// 或以赛区通知为准。这类赛事官网上的截止日期不是用户可执行的日期 ——
// 他所在学校的选拔可能早几周甚至几个月，而且各校不同，我们无法知道。
//
// 正确做法不是猜一个时间，而是明确告诉用户「这个日期不作数，去查你们学校」。
// 显示官方日期而不加说明，会让用户以为还有时间，等他发现时组队早就结束了。
// 官方日期本质上只是参考值：学校可能早就组织完了，官网也可能没更新。
// 可靠程度分三档，「不知道」必须单独成一档 ——
// 把未确认的当成可靠，等于替主办方向用户担保一个我们没核实过的日期。
const TIMING_RELIABILITY = {
  '需先校内选拔':'school_controlled',
  '学校统一报名':'school_controlled',
  '以赛区或学校通知为准':'school_controlled',
  '两种方式均可':'unverified',
  '暂未明确':'unverified',
  '自行报名':'official',
};
const SCHOOL_TIMING_NOTES = {
  '需先校内选拔':'需先通过校内选拔。校赛时间各校不同，通常远早于官方截止日，很可能已经开始组队。',
  '学校统一报名':'由学校统一报名。你校的内部截止日期通常早于官方日期。',
  '以赛区或学校通知为准':'报名时间以赛区或学校通知为准，官方日期仅供参考。',
  '两种方式均可':'可自行报名，也可能由学校统一组织，两条路的截止时间不一定相同。',
  '暂未明确':'报名组织方式尚未确认，官方日期可能不是你实际要赶的时间。',
};
const SCHOOL_TIMING_ACTION = '请尽快向教务处、学院或指导老师确认本校安排，不要等到官方截止日。';

function schoolTimingAdvice(record = {}) {
  const organization = record.registrationOrganization || record.registration_organization || '';
  const reliability = TIMING_RELIABILITY[organization] || 'unverified';
  if (reliability === 'official') return { dependent:false, reliability, organization, note:'' };
  const note = SCHOOL_TIMING_NOTES[organization] || SCHOOL_TIMING_NOTES['暂未明确'];
  return { dependent:true, reliability, organization, note:`${note}${SCHOOL_TIMING_ACTION}` };
}

function valueFields(record = {}) {
  const timing = schoolTimingAdvice(record);
  const amount = Number(record.rewardAmount);
  const count = Number(record.participantCount);
  return {
    reward_amount:Number.isFinite(amount) && amount >= 0 ? amount : null,
    reward_tier:normalizeEnum(record.rewardTier, REWARD_TIERS, '暂未公布'),
    reward_highlights:uniqueFrom(record.rewardHighlights, REWARD_HIGHLIGHTS),
    rewards:String(record.rewards || ''),
    participant_count:Number.isFinite(count) && count >= 0 ? count : null,
    participant_unit:normalizeEnum(record.participantUnit, PARTICIPANT_UNITS, '暂未公布'),
    scale_tier:normalizeEnum(record.scaleTier, SCALE_TIERS, '暂未公布'),
    participant_scale:String(record.participantScale || ''),
    region:String(record.region || ''),
    lifecycle:normalizeEnum(record.lifecycle, LIFECYCLES, '暂未明确'),
    recognition:normalizeRecognition(record.recognition),
    value_scores:valueScores(record),
    school_timing_dependent:timing.dependent,
    school_timing_note:timing.note,
    timing_reliability:timing.reliability,
  };
}

module.exports = {
  REWARD_TIERS, REWARD_HIGHLIGHTS, SCALE_TIERS, PARTICIPANT_UNITS, LIFECYCLES, REGISTRATION_ORGANIZATIONS,
  RECOGNITION_PATHS, RECOGNITION_LEVELS, MAX_VALUE_SCORE,
  deriveRewardTier, deriveScaleTier,
  normalizeRecognition, valueScores, bestValueScore, valueFields,
  SCHOOL_TIMING_NOTES, TIMING_RELIABILITY, schoolTimingAdvice,
};
