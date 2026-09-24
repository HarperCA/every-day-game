import { describe, expect, it } from 'vitest';
import { QUERY_TEMPLATES, hostOf, isOutOfScopeReference, isRelevant, toCandidate } from '../scripts/server/search-baidu.mjs';

describe('professional registration search queries', () => {
  it('uses the recent-registration pattern across 31 specialties', () => {
    expect(QUERY_TEMPLATES).toHaveLength(31);
    expect(QUERY_TEMPLATES.every(query => query.includes('最近可报名的大学生') && query.includes('专业竞赛 官网 报名入口'))).toBe(true);
    expect(QUERY_TEMPLATES.some(query => /校内选拔|竞赛目录|获奖新闻/.test(query))).toBe(false);
  });
});

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

describe('keeping discovery and the admission gate on the same scope rules', () => {
  // 这几条正是历史上真被误收、后来不得不写 delete-out-of-scope-*.mjs 删掉的样本。
  // 它们全都含"大赛/巡回赛"，相关性关键词拦不住，只有收录范围判断能拦。
  it.each([
    '芜湖市神山音乐节大学生歌手大赛',
    '2026年中国魔方运动巡回赛暨段级位积分赛（湖北随州站）',
    '2026年中国男子飞盘公开赛',
    '2026年"智力猎狐"全国无线电测向教育竞赛（山西忻州站）',
    '"奔跑吧,少年" 2026年黑龙江省篮球锦标赛(男子甲组) 竞赛规程',
  ])('drops out-of-scope result before it costs an extraction call: %s', title => {
    expect(isOutOfScopeReference({ title })).toBe(true);
  });

  it('still lets ordinary college competitions through', () => {
    expect(isOutOfScopeReference({ title: '2026年辽宁省大学生智慧电力运行控制创新竞赛' })).toBe(false);
    expect(isOutOfScopeReference({ title: '第五届福建省大学生化工设计竞赛' })).toBe(false);
  });

  it('does not drop notice pages at the source', () => {
    // 通知页是合法线索：SLA 允许通知作为证据，resolve-notice-leads.mjs 负责从中
    // 追溯真实赛事。在源头砍掉通知等于砍掉整条线索通道，属于误杀。
    expect(isOutOfScopeReference({ title: '关于举办2026年山东省大学生结构设计竞赛的通知' })).toBe(false);
  });
});
