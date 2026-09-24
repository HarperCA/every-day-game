import { describe, expect, it, vi } from 'vitest';
import { classifyCandidateWithJev, deterministicCandidateDecision, filterCandidatesWithJev } from '../scripts/crawler/lib/jevCandidateFilter.mjs';

describe('Jev crawler pre-filter hard rules', () => {
  it.each([
    ['关于举办全国大学生数学竞赛的通知', null],
    ['2026年大学生学科竞赛目录清单', 'lead'],
    ['挑战杯某大学校级选拔赛', 'reject'],
    ['某学院获全国大学生测绘大赛一等奖', 'reject'],
    ['大赛动态', 'reject'],
    ['中国机械工程学会', 'reject'],
    ['兰州城市学院创新创业学院', 'reject'],
    ['全国大学生创新大赛正式启动', 'reject'],
    ['一起来参加全国大学生设计大赛!', 'reject'],
  ])('%s -> %s', (name, action) => expect(deterministicCandidateDecision({ name })?.action || null).toBe(action));
});

describe('Jev crawler semantic filter', () => {
  it('continues fetching a high-confidence official competition', async () => {
    const fetchImpl = vi.fn(async () => ({ ok:true, json:async () => ({ answers:{ kind:{ choice:'competition_site', confidence:0.97, probabilities:{ competition_site:0.97 } } }, usage:{ cost:0.00001 } }) }));
    const result = await classifyCandidateWithJev({ name:'全国大学生数学建模竞赛', detailUrl:'https://example.com' }, { apiKey:'test', fetchImpl });
    expect(result.action).toBe('fetch');
    expect(result.confidence).toBe(0.97);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('holds a low-confidence answer for review instead of silently rejecting it', async () => {
    const fetchImpl = async () => ({ ok:true, json:async () => ({ answers:{ kind:{ choice:'unrelated', confidence:0.61 } }, usage:{ cost:0.00001 } }) });
    const result = await classifyCandidateWithJev({ name:'未来工程创新挑战', detailUrl:'https://example.com' }, { apiKey:'test', fetchImpl });
    expect(result.action).toBe('review');
  });

  it('fails open on API errors so Jev cannot stop the crawler', async () => {
    const result = await filterCandidatesWithJev([{ name:'专业赛事', detailUrl:'https://example.com' }], { apiKey:'test', fetchImpl:async () => { throw new Error('network'); } });
    expect(result.fetch).toHaveLength(1);
    expect(result.decisions[0].source).toBe('fallback');
  });

  it('does not spend API calls on deterministic rejects', async () => {
    const fetchImpl = vi.fn();
    const result = await filterCandidatesWithJev([{ name:'大赛动态' }], { apiKey:'test', fetchImpl });
    expect(result.rejected).toHaveLength(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('classifies several candidates in a single request', async () => {
    const fetchImpl = vi.fn(async () => ({ ok:true, json:async () => ({ answers:{ item_0:{ choice:'competition_site', confidence:0.95, probabilities:{ competition_site:0.95 } }, item_1:{ choice:'organizer_notice', confidence:0.91, probabilities:{ organizer_notice:0.91 } } }, usage:{ cost:0.00002 } }) }));
    const result = await filterCandidatesWithJev([{ name:'全国大学生数学建模竞赛' }, { name:'关于举办某专业竞赛的通知' }], { apiKey:'test', fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result.fetch).toHaveLength(2);
    expect(result.cost).toBeCloseTo(0.00002);
  });
});

describe('formal notice routing', () => {
  it('fetches an organizer notice as evidence without treating its title as the event', async () => {
    const fetchImpl = async () => ({ ok:true, json:async () => ({ answers:{ kind:{ choice:'organizer_notice', confidence:0.95, probabilities:{ organizer_notice:0.95 } } }, usage:{ cost:0.00001 } }) });
    const result = await classifyCandidateWithJev({ name:'关于举办全国大学生专业竞赛的通知' }, { apiKey:'test', fetchImpl });
    expect(result.action).toBe('fetch');
    expect(result.kind).toBe('organizer_notice');
  });
});
