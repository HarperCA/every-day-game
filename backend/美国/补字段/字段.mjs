// 补字段能补哪些字段（2026-11-03 用户定）：字段名用新比赛库的；必须 = 新候选补不到就不入库，已有记录补不到要再查。
// 类型决定程序怎么核对（核对.mjs）：文字要在原文里逐字找到；日期要在原文里写着同一天；网址要在读过的网页里出现过；专业是十三类之一、有原文依据。
export const 字段表 = {
  name: { 名: '比赛名称', 类型: '文字', 必须: true },
  registration_start: { 名: '报名开始', 类型: '日期', 必须: true },
  registration_end: { 名: '报名截止', 类型: '日期', 必须: true },
  competition_start: { 名: '比赛开始', 类型: '日期', 必须: true },
  competition_end: { 名: '比赛结束', 类型: '日期', 必须: true },
  organizer: { 名: '主办方', 类型: '文字', 必须: true },
  participants: { 名: '参赛对象', 类型: '文字', 必须: true },
  eligibility: { 名: '大学生参赛资格依据', 类型: '文字', 必须: true },
  format_and_rules: { 名: '赛制与规则', 类型: '文字', 必须: true },
  professions: { 名: '专业分类', 类型: '专业', 必须: true },
  registration_url: { 名: '报名入口', 类型: '网址', 必须: false },
  registration_method: { 名: '报名方式', 类型: '文字', 必须: false },
  fees: { 名: '费用', 类型: '文字', 必须: false },
  rewards: { 名: '奖励', 类型: '文字', 必须: false },
};

// 和小程序筛选、05 审核三项核验（pipeline/modules/05-review/三项核验/schema.mjs）用的十三类一致
export const 专业分类 = ['综合/不限专业', '计算机与AI', '电子信息', '经管与商科', '生物与医药', '机械与自动化', '数学与统计', '材料与化工',
  '能源与环境', '设计与艺术', '人文与法学', '外语与教育', '建筑与土木'];

// 能标“待公布”的只有时间
export const 能待公布 = key => 字段表[key]?.类型 === '日期';
