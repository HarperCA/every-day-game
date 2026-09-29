import { describe, expect, it } from 'vitest';
import { competitionNameFromNotice, selectLeads, followupCandidatesFromReport } from '../scripts/server/resolve-notice-leads.mjs';

describe('formal notice leads', () => {
  it('extracts the actual contest name from a nested notice title', () => {
    expect(competitionNameFromNotice('关于举办山东省大学生科技赛事——山东省大学生结构设计竞赛的通知')).toBe('山东省大学生结构设计竞赛');
  });
  it('rejects unrelated contests returned by search', () => {
    const refs = [
      { title:'全国大学生绿色化妆品创新创意大赛', url:'https://other.example/news', content:'报名开始' },
      { title:'山东省大学生结构设计竞赛章程', url:'https://official.example/rules', content:'赛事组织机构' },
    ];
    expect(selectLeads(refs, 'https://notice.example/article', '山东省大学生结构设计竞赛').map(item => item.url)).toEqual(['https://official.example/rules']);
  });
});

it('turns traced pages into candidates without admitting the notice title', () => {
  const candidates = followupCandidatesFromReport({results:[{
    noticeUrl:'https://school.edu/notice', proposedName:'全国大学生结构设计竞赛',
    leads:[{title:'赛事官网',url:'https://contest.org/home',summary:'官方赛事页面'}],
  }]});
  expect(candidates).toHaveLength(1);
  expect(candidates[0].name).toBe('赛事官网');
  expect(candidates[0].proposedCompetitionName).toBe('全国大学生结构设计竞赛');
  expect(candidates[0].discoveryNoticeUrl).toBe('https://school.edu/notice');
  expect(followupCandidatesFromReport({results:[{proposedName:'赛事通知',leads:[{url:'https://contest.org'}]}]})).toEqual([]);
});

describe('所有通知都能追溯：按上级赛事分组、按重要程度分配额度（2026-09-29）', async () => {
  const { groupNotices, noticeImportance } = await import('../scripts/server/resolve-notice-leads.mjs');
  const notices = [
    { name:'关于开展第八届全国大学生混凝土材料设计大赛校内选拔赛的通知', detailUrl:'https://a.edu.cn/1', introduction:'赛题详见官网 https://www.ccpa.com.cn/site/content/23851.html' },
    { name:'关于举办2026年全国大学生混凝土材料设计大赛校级选拔的通知', detailUrl:'https://b.edu.cn/2', introduction:'' },
    { name:'关于举办2026年湖南省大学生结构设计竞赛的通知', detailUrl:'https://c.edu.cn/3', introduction:'' },
    { name:'关于期末考试安排的通知', detailUrl:'https://d.edu.cn/4', introduction:'' },
  ];
  it('同一场比赛的多篇通知归成一组，摘要里的官网网址收进来；不是比赛的通知不收', () => {
    const groups = groupNotices(notices);
    expect(groups.map(g => [g.proposedName, g.notices.length])).toEqual([['全国大学生混凝土材料设计大赛', 2], ['湖南省大学生结构设计竞赛', 1]]);
    expect(groups[0].notices[0].urls).toEqual(['https://www.ccpa.com.cn/site/content/23851.html']);
  });
  it('被提到次数多、全国性的更优先', () => {
    const [concrete, hunan] = groupNotices(notices);
    expect(noticeImportance(concrete, 2026)).toBeGreaterThan(noticeImportance(hunan, 2026));
  });
});
