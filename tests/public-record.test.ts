// “信息不足”不再当推荐等级，只在缺信息的字段里显示（2026-10-01）
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { fieldText, hydratePublic } from '../apps/miniprogram/services/publicRecord';

const require = createRequire(import.meta.url);
const { relevance } = require('../apps/miniprogram/cloudfunctions/publicData/competitionRanking.js');

describe('推荐等级', () => {
  it('只显示真正评过的五档', () => {
    expect(hydratePublic({ recommendation:'值得参加' }).recommendationLevel).toBe('值得参加');
    expect(hydratePublic({ recommendation:'谨慎报名' }).recommendationLevel).toBe('谨慎报名');
  });
  it('库里默认的“信息不足”或没有等级：不显示推荐等级', () => {
    expect(hydratePublic({ recommendation:'信息不足' }).recommendationLevel).toBe('');
    expect(hydratePublic({}).recommendationLevel).toBe('');
    expect(hydratePublic({ recommendation:'信息不足' }).recommendation.recommendation).toBe('');
  });
});

describe('缺信息的字段写“信息不足”', () => {
  it('空的、只写着“暂未明确”“待确认”的', () => {
    for (const value of ['', null, undefined, '暂未明确', '待确认', '待官方资料补充', ' 未知 ']) expect(fieldText(value)).toBe('信息不足');
  });
  it('有内容的原样显示', () => {
    expect(fieldText('免费')).toBe('免费');
    expect(fieldText('报名费暂未明确，以通知为准')).toBe('报名费暂未明确，以通知为准');
  });
  it('详情页各字段都带上显示文字', () => {
    const item = hydratePublic({ organizer:'中国生物医学工程学会', fees:'暂未明确', participants:'' });
    expect(item.fieldText).toMatchObject({ organizer:'中国生物医学工程学会', fees:'信息不足', participants:'信息不足' });
  });
});

describe('排序：没评过级的不再垫底', () => {
  it('“信息不足”和没有等级按中间分，高于“谨慎报名”、低于“值得参加”', () => {
    const score = recommendation => relevance({ recommendation }).parts.recommendation;
    expect(score('信息不足')).toBe(0.5);
    expect(score(undefined)).toBe(0.5);
    expect(score('谨慎报名')).toBeLessThan(score('信息不足'));
    expect(score('值得参加')).toBeGreaterThan(score('信息不足'));
  });
});
