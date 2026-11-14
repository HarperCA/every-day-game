// AI 抽取要交回的格式：每个字段都带原文出处 quote，出处在正文里找不到的字段会被删掉。
// 字段名取自现有代码实际用到的（candidateToRecord.js、ingest-candidates.mjs 的 withExtraction）；
// 搬提示词时（adminData/competitionExtract.js）再逐个核对。
export const SINGLE_FIELDS = [
  'track_name',                 // 正文明示、当前候选对应的独立赛道
  'competition_name',           // 正文里写明的比赛全称
  'organizer',                  // 主办方
  'registration_start',         // 报名开始
  'registration_end',           // 报名截止
  'participants',               // 参赛对象
  'eligibility',                // 大学生参赛资格
  'format_and_rules',           // 赛制与规则
  'team_size',                  // 队伍人数
  'registration_method',        // 报名方式
  'registration_organization',  // 怎么报名（自行报名、学校统一报名……）
  'fees',                       // 费用
];
// 每个单项字段的样子：{ value: '……', quote: '原文里的一句话' }

export const LIST_FIELDS = {
  authority_signals: ['signal', 'quote'],             // 权威性线索
  reward_highlights: ['value', 'quote'],              // 非现金回报
  recognition_hints: ['path', 'level', 'quote'],      // 认可度建议（等级是判断，入库后要人确认）
};

// missing：原文没写明的项，文字列表

// 可选值：AI 交回的值不在这里面的整项丢掉（原文核对.mjs）。搬自 adminData/competitionValue.js；
// 报名组织方式、非现金回报和比赛库届次表的可选值一致（有测试核对）。
export const REWARD_HIGHLIGHTS = ['保研考研加分', '实习或直通面试', '就业绿色通道', '创业扶持', '国际交流', '证书荣誉', '实物奖品', '现金奖金'];
export const RECOGNITION_PATHS = ['保研考研', '求职就业', '出国留学', '创业融资'];
export const RECOGNITION_LEVELS = ['高', '中', '低', '暂未明确'];
export const REGISTRATION_ORGANIZATIONS = ['自行报名', '学校统一报名', '两种方式均可', '需先校内选拔', '以赛区或学校通知为准', '暂未明确'];
