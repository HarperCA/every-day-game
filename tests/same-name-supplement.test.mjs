// 读完详情、抽出真实比赛名后再和库里比一次：名字完全一致的不再新增，给已有那条补来源（2026-10-01）
import { describe, expect, it } from 'vitest';
import { findSameNameRecord, supplementSource } from '../scripts/server/same-name-supplement.mjs';

const record = (id, name, extra = {}) => ({ id, name, dataStatus:'published', sources:[{ id:`s-${id}`, url:`https://old.example.org/${id}` }], qualityIssues:[], ...extra });
const now = new Date('2026-10-01T04:00:00Z');

describe('找同名的已有记录', () => {
  const records = [
    record('a', '湖南省大学生化工设计竞赛', { dataStatus:'archived' }),
    record('b', '全国大学生英语词汇竞赛', { aliases:['NCEVC'] }),
    record('c', '全国大学生英语词汇竞赛', { dataStatus:'draft' }),
    record('d', '某某大学生创新大赛', { dataStatus:'quarantined' }),
  ];
  it('年份、届次、括号、引号不参与比较', () => {
    expect(findSameNameRecord('第十二届湖南省大学生化工设计竞赛（2026）', records)?.id).toBe('a');
    expect(findSameNameRecord('2026年第六届“全国大学生英语词汇竞赛”', records)?.id).toBe('b');
  });
  it('多条同名取已发布的；名字不完全一致就不算', () => {
    expect(findSameNameRecord('全国大学生英语词汇竞赛', records)?.id).toBe('b');
    expect(findSameNameRecord('全国大学生英语词汇大赛', records)).toBeNull();
    expect(findSameNameRecord('湖南省大学生化工设计', records)).toBeNull();
  });
  it('别名一致也算；规范化后太短的名字不据此判重', () => {
    expect(findSameNameRecord('NCEVC竞赛', [record('x', 'NCEVC竞赛')])?.id).toBe('x');
    expect(findSameNameRecord('园冶', [record('y', '园冶')])).toBeNull();
  });
  it('隔离的也找得出来（调用方据此不新增，但不改它）', () => {
    expect(findSameNameRecord('某某大学生创新大赛', records)?.dataStatus).toBe('quarantined');
  });
});

describe('补来源', () => {
  it('补一个待核验、非官方的来源和一条提示，其余字段原样不动', () => {
    const base = record('a', '湖南省大学生化工设计竞赛', { organizer:'湖南省化学化工学会', manualReview:'passed' });
    const next = supplementSource(base, { url:'http://www.hncci.com/news/notice/a401.html', foundName:'第十二届湖南省大学生化工设计竞赛', now });
    expect(next.sources).toHaveLength(2);
    expect(next.sources[1]).toMatchObject({ edition_id:'a', url:'http://www.hncci.com/news/notice/a401.html', is_official:false, validity_status:'unchecked' });
    expect(next.qualityIssues[0]).toContain('待核验是否官方');
    expect({ ...next, sources:undefined, qualityIssues:undefined }).toEqual({ ...base, sources:undefined, qualityIssues:undefined });
  });
  it('来源已经有了（网址写法不同也算）、网址不合法：原样返回', () => {
    const base = record('a', '某比赛竞赛', { sources:[{ id:'s', url:'https://www.example.org/race/' }] });
    expect(supplementSource(base, { url:'http://example.org/race', now })).toBe(base);
    expect(supplementSource(base, { url:'', now })).toBe(base);
    expect(supplementSource(base, { url:'javascript:alert(1)', now })).toBe(base);
  });
});
