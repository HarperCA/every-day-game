import { describe, expect, it } from 'vitest';
import { competitionRegion } from '../apps/admin/src/competitionRegion';

describe('admin competition region filter values', () => {
  it('uses an explicit region before title inference', () => {
    expect(competitionRegion({ region:'四川省', name:'全国大学生创新赛' })).toBe('四川省');
  });

  it('infers only clearly named region or event scope', () => {
    expect(competitionRegion({ name:'浙江省大学生程序设计竞赛' })).toBe('浙江省');
    expect(competitionRegion({ name:'全国大学生数学建模竞赛' })).toBe('全国');
    expect(competitionRegion({ name:'国际大学生创新大赛' })).toBe('国际');
    expect(competitionRegion({ name:'普通高校创新活动', eventLevel:'国家级' })).toBe('');
  });

  it('does not use organizer location as a region', () => {
    expect(competitionRegion({ name:'普通高校创新活动', organizer:'浙江大学' })).toBe('');
  });
});
