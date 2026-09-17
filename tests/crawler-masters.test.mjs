import { describe, expect, it } from 'vitest';
import { buildMastersFromRecords } from '../scripts/crawler/lib/masters.mjs';

describe('building dedupe masters from live database records', () => {
  it('collapses multiple editions of the same event into one master', () => {
    // 同一个 eventId 出现多次（不同届次），判重只需要一个主条目。
    const records = [
      { eventId:'evt-1', name:'蓝桥杯', aliases:[], sources:[{ url:'https://www.lanqiao.cn/a' }] },
      { eventId:'evt-1', name:'蓝桥杯', aliases:[], sources:[{ url:'https://www.lanqiao.cn/b' }] },
      { eventId:'evt-2', name:'挑战杯', aliases:['大挑'], sources:[{ url:'https://www.tiaozhanbei.net' }] },
    ];
    const masters = buildMastersFromRecords(records);
    expect(masters).toHaveLength(2);
    expect(masters[0]).toMatchObject({ id:'evt-1', standard_name:'蓝桥杯', website_url:'https://www.lanqiao.cn/a' });
  });

  it('derives sourceHosts from every source url, for the domain-based uncertain match', () => {
    const masters = buildMastersFromRecords([
      { eventId:'evt-1', name:'X 大赛', sources:[{ url:'https://a.example.com/x' }, { url:'https://b.example.com/y' }] },
    ]);
    expect(masters[0].sourceHosts).toEqual(['a.example.com', 'b.example.com']);
  });

  it('skips records with no eventId rather than crashing on malformed data', () => {
    expect(buildMastersFromRecords([{ name:'缺 id' }, null, undefined])).toEqual([]);
  });

  it('degrades safely when aliases or sources are missing', () => {
    const masters = buildMastersFromRecords([{ eventId:'evt-1', name:'X' }]);
    expect(masters[0]).toMatchObject({ aliases:[], website_url:'', sourceHosts:[] });
  });
});
