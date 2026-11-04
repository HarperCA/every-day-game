// 三项核验要交回的格式（和 prompt.md 的示例一致）。检查() 交回用不了的地方（null 表示合格）；有问题就报告给 AI 总管并抛错。
// 字段和取值搬自 adminData/competitionAiReview.js 的 fieldVerificationSchema，改成中文名。
export const 专业分类 = ['综合/不限专业', '计算机与AI', '电子信息', '经管与商科', '生物与医药', '机械与自动化', '数学与统计', '材料与化工',
  '能源与环境', '设计与艺术', '人文与法学', '外语与教育', '建筑与土木'];   // 和小程序筛选用的十三类一致
export const 日期状态 = ['一致', '原文没写', '不一致'];
export const 来源性质 = ['官方', '学校通知', '判断不了'];

export function 检查(data) {
  if (!data || typeof data !== 'object') return '没有交回 JSON 对象';
  for (const key of ['名称对不对', '报名网址对不对', '专业有把握']) if (typeof data[key] !== 'boolean') return `“${key}”要填 true 或 false`;
  for (const key of ['报名开始状态', '报名截止状态']) if (!日期状态.includes(data[key])) return `“${key}”「${data[key]}」不是 ${日期状态.join('/')} 之一`;
  if (!Array.isArray(data.专业分类)) return '“专业分类”要是列表';
  const 不认识 = data.专业分类.filter(x => !专业分类.includes(x));
  if (不认识.length) return `“专业分类”里有不在十三类里的：${不认识.join('、')}`;
  if (!来源性质.includes(data.来源性质)) return `“来源性质”「${data.来源性质}」不是 ${来源性质.join('/')} 之一`;
  return null;
}
