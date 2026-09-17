import { describe, expect, it } from 'vitest';
import { hostOf, isRelevant, toCandidate } from '../scripts/server/search-baidu.mjs';

describe('filtering search noise before it costs an extraction call', () => {
  it('keeps results whose title or snippet actually mentions a competition', () => {
    expect(isRelevant({ title: '2026年XX挑战赛报名通知', content: '' })).toBe(true);
    expect(isRelevant({ title: '', content: '关于举办第九届大学生programming竞赛的通知' })).toBe(true);
  });

  it('drops results with no competition-related keyword at all', () => {
    // 政策解读、人事任免这类和"竞赛"字都不沾边的，不值得占一次抽取额度。
    expect(isRelevant({ title: '教育部发布最新招生政策', content: '关于加强管理的意见' })).toBe(false);
    expect(isRelevant({})).toBe(false);
  });
});

describe('recognizing hosts we already have a dedicated crawler for', () => {
  it('strips the www prefix so bare and www hosts match the same way', () => {
    expect(hostOf('https://www.tianchi.aliyun.com/x')).toBe('tianchi.aliyun.com');
    expect(hostOf('https://tianchi.aliyun.com/x')).toBe('tianchi.aliyun.com');
  });

  it('returns empty string instead of throwing on an unparseable url', () => {
    expect(hostOf('not a url')).toBe('');
    expect(hostOf('')).toBe('');
  });
});

describe('mapping a search reference into a candidate', () => {
  const reference = { title: '2026年XX挑战赛报名通知', url: 'https://example.com/notice/123', content: '关于举办XX挑战赛的通知' };

  it('builds a stable id from the url, so a re-run updates rather than duplicates', () => {
    const first = toCandidate(reference, 'q1').externalId;
    const second = toCandidate(reference, 'q2').externalId;
    // 同一个 URL 不管来自哪条查询，都应该落在同一条候选上。
    expect(first).toBe(second);
    expect(first).toMatch(/^search-[0-9a-f]{16}$/);
  });

  it('two different urls never collide on the same id', () => {
    const a = toCandidate(reference, 'q').externalId;
    const b = toCandidate({ ...reference, url: 'https://example.com/notice/456' }, 'q').externalId;
    expect(a).not.toBe(b);
  });

  it('leaves every judgment/structured field empty — a search snippet cannot answer them', () => {
    // 和 DataFountain 对报名时间的处理是同一个道理：不知道就不填，
    // 这里连"大概是不是报名区间"这点线索都没有，更不能编。
    const candidate = toCandidate(reference, 'q');
    expect(candidate.organizer).toBe('');
    expect(candidate.reward_amount).toBeNull();
    expect(candidate.registration_start).toBeNull();
    expect(candidate.needsReview).toContain('organizer');
    expect(candidate.needsReview).toContain('registration_start');
  });

  it('degrades safely when the reference is missing title or url', () => {
    const bare = toCandidate({}, 'q');
    expect(bare.name).toBe('');
    expect(bare.detailUrl).toBe('');
    expect(bare.externalId).toMatch(/^search-[0-9a-f]{16}$/);
  });
});
