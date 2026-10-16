// Browser-side precheck for the most decisive scope rules. The server's
// competitionScope.js remains the final authority at publication time.
const collegeAudience = /大学生|本科|专科|研究生|硕士|博士|高职|高专|高校|高等(?:学校|院校|教育)|在校(?:生|学生|大学生)|在读(?:生|学生)|学籍|MBA|MPA/i;

export function publishScopeIssue(record: any): string | null {
  const title = String(record.name || '').normalize('NFKC').trim();
  if (!title) return '缺少赛事名称';
  if (/中小学|小学生|初中生|高中生|青少年|少年儿童|全国少年|奔跑吧[\s,，·•、]*少年/.test(title)) return '赛事范围不符合大学生竞赛要求';
  if (/校级(?:选拔赛|初赛)|校内(?:选拔赛|初赛|赛)|院级(?:选拔赛|初赛)|学院选拔赛/.test(title) && !record.parentEventId) return '校赛或院赛需要关联上级赛事';
  if (/[（(]\s*(?:初赛|复赛|预赛|半决赛|决赛)(?:阶段)?\s*[）)]/.test(title) && !record.parentEventId) return '比赛阶段不能单独发布为赛事';
  if (/目录|清单|汇总|资讯速递|参赛指南|赛题分析|报名表|获奖名单|晋级.*名单|喜报/.test(title)) return '资料或赛后报道不是独立赛事';
  const listedAward = Boolean(record.curationList) && /(?:奖|展|展示|活动)[\s)）\]】]*$/.test(title);
  if (!listedAward && !/竞赛|大赛|挑战赛|锦标赛|联赛|黑客松|奥林匹克|比赛|挑战|赛[\s)）\]】]*$|ICPC|CCSP|RoboMaster|ROBOCON/i.test(title)) return '标题尚不能确认是一场具体比赛';
  const audience = `${record.participants || ''} ${record.eligibility || ''}`.trim();
  if (audience && !collegeAudience.test(audience)) return '参赛对象未表明大学生可以参加';
  if (!audience && !collegeAudience.test(title) && !/ICPC|CCSP/i.test(title)) return '缺少大学生参赛资格依据';
  return null;
}
