// 收录门槛：竞赛雷达什么竞赛都收，但水赛不收。
//
// 最重要的一条前提：「冷门」不是「水赛」。
// 参赛人数少恰恰是产品要找的目标（冷门但高回报），
// 所以规模小、知名度低，绝不能作为拒收依据 —— 否则门槛会挡掉最有价值的那批。
//
// 水赛的真实特征是另一组东西：
//   收费高 + 门槛极低 + 人人有奖 + 主办方无行业地位 + 证书无实际用途
// 其中「人人有奖」和「无权威背书」是核心，收费本身不是原罪
//   （不少正规赛事也收报名费，而不少水赛反而免费，靠后续培训/证书收费）。
//
// 判定分三档，刻意保守：
//   admit  —— 有明确的权威背书或实质回报，可直接进入待审队列
//   review —— 信息不足，需要人工或 AI 判断。这是默认档，不是失败
//   reject —— 命中水赛红旗，且没有任何抵消证据
//
// 宁可多放到 review，也不要自动拒收：误拒一个好赛事没人会发现，
// 而它恰恰可能就是用户找不到的那一个。

// 主办方带这些字样，说明背后有学术组织或行政机构，不是随便一家公司。
const AUTHORITY_PATTERNS = [
  { pattern:/教育部|共青团中央|中国科协|工业和信息化部|科技部|人力资源和社会保障部/, signal:'行政机构主办', weight:3 },
  { pattern:/一级学会|中国[一-龥]{2,8}学会|全国[一-龥]{2,8}学会/, signal:'全国性学会主办', weight:3 },
  { pattern:/学会|协会|研究会|专业委员会|专委会|学术委员会/, signal:'学术组织参与', weight:2 },
  { pattern:/全国组委会|组织委员会|指导委员会|教学指导委员会/, signal:'设有组委会', weight:1 },
  { pattern:/大会|学术会议|评测|挑战赛技术报告|论文/, signal:'依托学术会议', weight:1 },
];

// 水赛红旗。命中任一条都需要抵消证据才能收录。
const RED_FLAGS = [
  { pattern:/人人有奖|保证获奖|100%获奖|全员获奖|包过|包拿奖/, signal:'宣称人人有奖', weight:4 },
  { pattern:/获奖率\s*(9[0-9]|100)\s*%/, signal:'获奖率畸高', weight:4 },
  { pattern:/证书可查询?[^。；]{0,10}(收费|付费|工本费)/, signal:'证书另行收费', weight:3 },
  { pattern:/滚动报名|随时报名|每月一期|每周一期|常年招生/, signal:'无固定赛期，疑似流水线', weight:2 },
  { pattern:/含金量极高|国家级含金量|保研必备|稳拿/, signal:'夸张宣传话术', weight:2 },
];

const ADMIT_SCORE = 3;   // 达到即可进入待审队列
const REJECT_SCORE = 4;  // 红旗累计达到且无抵消证据，才拒收

function scanPatterns(text, rules) {
  const hits = [];
  let score = 0;
  for (const rule of rules) {
    if (rule.pattern.test(text)) {
      hits.push(rule.signal);
      score += rule.weight;
    }
  }
  return { hits, score };
}

// record 可以是库中记录，也可以是抓取产出的候选。
// 只读取文本和已核实的数值，不做任何推断。
function collectText(record = {}) {
  return [
    record.organizer, record.introduction, record.description,
    record.rewards, record.formatAndRules, record.format_and_rules,
    record.registrationMethod, record.registration_method, record.fees,
  ].filter(value => typeof value === 'string').join('\n');
}

function admissionSignals(record = {}) {
  const text = collectText(record);
  const authority = scanPatterns(text, AUTHORITY_PATTERNS);
  const redFlags = scanPatterns(text, RED_FLAGS);

  const positives = [...authority.hits];
  let score = authority.score;

  // 已核实的分路径认可度是最硬的证据，比任何关键词都可靠。
  const recognition = Array.isArray(record.recognition) ? record.recognition : [];
  const strong = recognition.filter(item => item && (item.level === '高' || item.level === '中'));
  if (strong.length) {
    positives.push(`已核实认可度：${strong.map(item => `${item.path}(${item.level})`).join('、')}`);
    score += 4;
  }

  // 实质性的非现金回报说明主办方真的投入了资源。
  const highlights = Array.isArray(record.rewardHighlights) ? record.rewardHighlights
    : (Array.isArray(record.reward_highlights) ? record.reward_highlights : []);
  const substantive = highlights.filter(item => item !== '现金奖金' && item !== '实物奖品' && item !== '证书荣誉');
  if (substantive.length) {
    positives.push(`实质回报：${substantive.join('、')}`);
    score += 2;
  }

  return { positives, redFlags:redFlags.hits, score, redFlagScore:redFlags.score };
}

function assessAdmission(record = {}) {
  const signals = admissionSignals(record);
  const { score, redFlagScore, positives, redFlags } = signals;

  // 规模和知名度都不参与判定 —— 冷门正是我们要找的。
  if (redFlagScore >= REJECT_SCORE && score < redFlagScore) {
    return {
      verdict:'reject',
      reason:`命中水赛特征（${redFlags.join('、')}），且没有抵消证据`,
      ...signals,
    };
  }
  if (score >= ADMIT_SCORE) {
    return {
      verdict:'admit',
      reason:`有可查的价值证据（${positives.join('、')}）${redFlags.length ? `；但仍需留意：${redFlags.join('、')}` : ''}`,
      ...signals,
    };
  }
  return {
    verdict:'review',
    reason:positives.length
      ? `证据偏弱（${positives.join('、')}），需要确认主办方与回报`
      : '缺少可查的价值证据，需要人工或 AI 判断',
    ...signals,
  };
}

module.exports = {
  AUTHORITY_PATTERNS, RED_FLAGS, ADMIT_SCORE, REJECT_SCORE,
  admissionSignals, assessAdmission,
};
