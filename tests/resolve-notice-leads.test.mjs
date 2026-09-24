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
