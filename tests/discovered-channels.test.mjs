import { describe, expect, it } from 'vitest';
import { classifySourceType, extractChannelEntries, hostOf, isKnownAggregator, mergeDiscoveredChannels } from '../scripts/crawler/lib/discoveredChannels.mjs';

describe('discovered channels asset', () => {
  it('extracts a normalized host from a url', () => {
    expect(hostOf('https://www.jsjds.com.cn/register')).toBe('jsjds.com.cn');
    expect(hostOf('not a url')).toBe('');
  });

  it('recognizes the already-known aggregator platforms', () => {
    expect(isKnownAggregator('tianchi.aliyun.com')).toBe(true);
    expect(isKnownAggregator('sub.datafountain.cn')).toBe(true);
    expect(isKnownAggregator('random-school.edu.cn')).toBe(false);
  });

  it('classifies host by TLD/pattern as a rough hint', () => {
    expect(classifySourceType('jyt.hunan.gov.cn')).toBe('政府/教育主管部门');
    expect(classifySourceType('jwc.pku.edu.cn')).toBe('高校官网');
    expect(classifySourceType('mp.weixin.qq.com')).toBe('微信公众号文章');
    expect(classifySourceType('example.com')).toBe('其他网站');
  });

  it('drops known aggregators and entries without a resolvable host when extracting', () => {
    const entries = extractChannelEntries([
      { url: 'https://tianchi.aliyun.com/competition/1', name: 'A' },
      { url: 'https://jwc.example.edu.cn/notice/1', name: 'B', query: 'q1' },
      { url: 'not-a-url', name: 'C' },
    ]);
    expect(entries).toEqual([{ host: 'jwc.example.edu.cn', url: 'https://jwc.example.edu.cn/notice/1', name: 'B', query: 'q1' }]);
  });

  it('merges new entries by host, accumulating counts and keeping first/last seen times', () => {
    const first = mergeDiscoveredChannels({}, [{ host: 'jwc.a.edu.cn', url: 'https://jwc.a.edu.cn/1', name: '赛事A', query: 'q1' }], '2026-09-01T00:00:00.000Z');
    expect(first['jwc.a.edu.cn']).toMatchObject({ admittedCount: 1, firstSeenAt: '2026-09-01T00:00:00.000Z', lastSeenAt: '2026-09-01T00:00:00.000Z' });

    const second = mergeDiscoveredChannels(first, [{ host: 'jwc.a.edu.cn', url: 'https://jwc.a.edu.cn/2', name: '赛事B', query: 'q2' }], '2026-10-01T00:00:00.000Z');
    expect(second['jwc.a.edu.cn']).toMatchObject({ admittedCount: 2, firstSeenAt: '2026-09-01T00:00:00.000Z', lastSeenAt: '2026-10-01T00:00:00.000Z' });
    expect(second['jwc.a.edu.cn'].queries).toEqual(['q1', 'q2']);
  });

  it('does not mutate the existing map it was given', () => {
    const existing = { 'a.edu.cn': { host: 'a.edu.cn', admittedCount: 1 } };
    mergeDiscoveredChannels(existing, [{ host: 'b.edu.cn', url: 'https://b.edu.cn', name: 'x' }], '2026-09-01T00:00:00.000Z');
    expect(existing).toEqual({ 'a.edu.cn': { host: 'a.edu.cn', admittedCount: 1 } });
  });
});
