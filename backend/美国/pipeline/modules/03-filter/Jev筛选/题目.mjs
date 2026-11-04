// 问 Jev 的选择题：判断搜索结果页面是哪一类。类别和说明搬自 crawler/lib/jevCandidateFilter.mjs 的 JEV_CRITERIA（原文不变）。
// 改题目时把版本号加一，报告问题时一起记下，能对照前后效果。
export const 版本 = 'jev-classify-v1';

export const 说明 = '判断这个搜索结果页面的类型。只根据标题、摘要、网址和来源判断；不能把学校转载当成承办方正式通知。';

export const 类别说明 = Object.freeze({
  competition_site: '当届大学生专业赛事官网或正式赛事详情页，不是新闻、通知、目录、校赛或兴趣活动',
  organizer_notice: '主办方或承办方发布的当届正式赛事通知，包含具体比赛信息，可作为核验证据但通知标题不可直接入赛事库',
  registration_entry: '当届赛事的官方报名平台或报名入口页面',
  directory_lead: '教育厅、学会或其他权威机构的省级赛事目录、项目清单或汇总页面，只作为进一步挖掘线索',
  repost_or_school_selection: '普通转载、学校组织报名通知、校级选拔或校内赛，不是上级赛事自身的官方入口',
  news_or_result: '获奖新闻、结果公示、决赛举行、启动开幕或赛后报道',
  unrelated: '中小学生赛事、兴趣娱乐、群众体育、网站栏目、培训或其他与大学生专业竞赛无关内容',
});

export const 类别们 = Object.keys(类别说明);

export const 题目 = () => ({ kind: { type: 'choice', instructions: 说明, criteria: 类别说明 } });
