import { describe, expect, it } from 'vitest';
import { evidenceLinks, rankEvidenceLinks } from '../scripts/crawler/lib/jevLinkRanker.mjs';

describe('evidence link discovery', () => {
  it('finds a registration link while ignoring navigation and javascript', () => {
    const links = evidenceLinks('<a href="/signup">报名入口</a><a href="javascript:void(0)">赛事章程</a><a href="/home">首页</a>', 'https://contest.example.org/');
    expect(links).toEqual([{ label:'报名入口', url:'https://contest.example.org/signup' }]);
  });
  it('uses one Jev request to rank multiple links', async () => {
    let calls = 0;
    const ranked = await rankEvidenceLinks([{ label:'赛事章程', url:'https://a.test/rules' }, { label:'报名入口', url:'https://a.test/apply' }], {
      apiKey:'test', fetchImpl:async () => { calls += 1; return { ok:true, json:async () => ({ answers:{ link_0:{ choice:'rules', probabilities:{ rules:0.9 } }, link_1:{ choice:'registration', probabilities:{ registration:0.98 } } } }) }; },
    });
    expect(calls).toBe(1);
    expect(ranked[0].kind).toBe('registration');
  });
});
