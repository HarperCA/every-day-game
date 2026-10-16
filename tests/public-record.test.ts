// “信息不足”不再当推荐等级，只在缺信息的字段里显示（2026-10-01）
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { fieldText, hydratePublic, reminderTarget } from '../apps/miniprogram/services/publicRecord';

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

describe('报名日期提醒', () => {
  it('uses Beijing day boundaries for date-only start and deadline', () => {
    expect(reminderTarget('2026-10-03', 'start')).toBe('2026-10-03T00:00:00+08:00');
    expect(reminderTarget('2026-10-03', 'end')).toBe('2026-10-03T23:59:59+08:00');
    expect(hydratePublic({registration_end:'2026-10-03'}).registrationEnd).toBe('2026-10-03T23:59:59+08:00');
  });
});

describe('时间说明、奖项、参赛资格', () => {
  it('时间说明去首尾空白，没有时为空', () => {
    expect(hydratePublic({ time_note:'  报名时间由各省赛区确定\n全国总决赛预计 11 月  ' }).timeNote).toBe('报名时间由各省赛区确定\n全国总决赛预计 11 月');
    expect(hydratePublic({}).timeNote).toBe('');
  });
  it('奖项说明和亮点标签', () => {
    const item = hydratePublic({ rewards:' 一等奖 5 项，颁发证书和奖金 ', reward_highlights:['证书荣誉', '奖金'] });
    expect(item.rewards).toBe('一等奖 5 项，颁发证书和奖金');
    expect(item.rewardHighlights).toEqual(['证书荣誉', '奖金']);
    expect(item.fieldText.rewards).toBe('一等奖 5 项，颁发证书和奖金');
  });
  it('没有奖项信息：空字符串、空数组，亮点不是数组也当空', () => {
    const item = hydratePublic({ reward_highlights:'奖金' });
    expect(item.rewards).toBe('');
    expect(item.rewardHighlights).toEqual([]);
    expect(item.fieldText.rewards).toBe('信息不足');
  });
  it('参赛资格有内容且跟参赛对象不同：单独显示', () => {
    const item = hydratePublic({ participants:'全日制在校本科生', eligibility:'须由一名指导教师推荐' });
    expect(item.showEligibility).toBe(true);
    expect(item.fieldText.eligibility).toBe('须由一名指导教师推荐');
  });
  it('参赛资格为空、只写“暂未明确”“待确认”、或跟参赛对象只差空白：不单独显示', () => {
    expect(hydratePublic({ participants:'在校大学生' }).showEligibility).toBe(false);
    expect(hydratePublic({ participants:'在校大学生', eligibility:'  ' }).showEligibility).toBe(false);
    expect(hydratePublic({ participants:'在校大学生', eligibility:'暂未明确' }).showEligibility).toBe(false);
    expect(hydratePublic({ participants:'在校大学生', eligibility:'待确认' }).showEligibility).toBe(false);
    expect(hydratePublic({ participants:'全日制 在校本科生', eligibility:' 全日制在校本科生 ' }).showEligibility).toBe(false);
  });
});
