import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { flattenRaces, toCandidate, toIso } from '../scripts/crawler/crawl-tianchi.mjs';

const require = createRequire(import.meta.url);
const { deriveRewardTier, deriveScaleTier } = require('../apps/miniprogram/cloudfunctions/adminData/competitionValue.js');

describe('tier derivation', () => {
  it('separates "no cash prize" from "not published yet"', () => {
    // 0 是主办方明确不给奖金；null 是我们还不知道。混为一谈会让排序把未知当已知。
    expect(deriveRewardTier(0)).toBe('无现金奖励');
    expect(deriveRewardTier(null)).toBe('暂未公布');
    expect(deriveRewardTier(undefined)).toBe('暂未公布');
    expect(deriveRewardTier('')).toBe('暂未公布');
  });

  it('maps amounts onto the published tiers', () => {
    expect(deriveRewardTier(5000)).toBe('万元以下');
    expect(deriveRewardTier(55000)).toBe('1万-10万');
    expect(deriveRewardTier(280000)).toBe('10万-50万');
    expect(deriveRewardTier(800000)).toBe('50万以上');
    expect(deriveRewardTier(-1)).toBe('暂未公布');
  });

  it('maps participant counts without converting teams into people', () => {
    // 每队几人因赛制而异，换算等于编造 —— 档位按「参赛单位数」计。
    expect(deriveScaleTier(169)).toBe('千人以下');
    expect(deriveScaleTier(5000)).toBe('千人-1万');
    expect(deriveScaleTier(50000)).toBe('1万-10万');
    expect(deriveScaleTier(200000)).toBe('10万以上');
    expect(deriveScaleTier(null)).toBe('暂未公布');
  });
});

describe('tianchi time parsing', () => {
  it('reads the api timestamps as Beijing time', () => {
    expect(toIso('2026-09-11 00:00:00')).toBe('2026-09-10T16:00:00.000Z');
  });

  it('refuses anything that is not the expected shape', () => {
    expect(toIso('')).toBeNull();
    expect(toIso('2026-09-11')).toBeNull();
    expect(toIso('not a date')).toBeNull();
    expect(toIso(null)).toBeNull();
  });
});

describe('series flattening', () => {
  it('uses the track as the entry unit and keeps the series name', () => {
    // 系列赛本身不能报名，能报名的是赛道。
    const flat = flattenRaces([
      { raceId:1, name:'具身极限挑战赛', trackList:[{ raceId:11, name:'仿真合成' }, { raceId:12, name:'安全应用' }] },
      { raceId:2, name:'独立赛事' },
    ]);
    expect(flat.map(race => race.raceId)).toEqual([11, 12, 2]);
    expect(flat[0].seriesName).toBe('具身极限挑战赛');
    expect(flat[2].seriesName).toBeUndefined();
  });
});

describe('mapping a race into a candidate', () => {
  const race = {
    raceId:532514, name:'蚂蚁灵波具身大模型挑战赛', bonus:280000, teamCount:169,
    signupStartTime:'2026-09-11 00:00:00', signupEndTime:'2026-10-26 23:59:59',
    raceStartTime:'2026-09-11 00:00:00', raceEndTime:'2026-11-15 23:59:59',
    tagsList:[{ tagNameCn:'机器人' }, { tagNameCn:'计算机视觉' }], introduction:'一场面向具身智能开发者的算法挑战赛。',
  };

  it('fills the numeric fields the api can actually answer', () => {
    const candidate = toCandidate(race);
    expect(candidate).toMatchObject({
      externalId:'tianchi-532514',
      reward_amount:280000, reward_tier:'10万-50万',
      participant_count:169, participant_unit:'队', scale_tier:'千人以下',
    });
    expect(candidate.registration_end).toBe('2026-10-26T15:59:59.000Z');
  });

  it('leaves judgment fields empty rather than guessing them', () => {
    // 认可度是行业共识，面试绿卡要读详情页 —— 列表接口回答不了，编造比留空有害。
    const candidate = toCandidate(race);
    expect(candidate.recognition).toEqual([]);
    expect(candidate.region).toBe('');
    expect(candidate.lifecycle).toBe('暂未明确');
    expect(candidate.needsReview).toContain('recognition');
  });

  it('records a checkable source for every filled field', () => {
    const candidate = toCandidate(race);
    expect(candidate.evidence.url).toBe('https://tianchi.aliyun.com/competition/entrance/532514');
    expect(candidate.evidence.fields).toContain('reward_amount');
  });

  it('does not claim a cash reward when the prize pool is zero', () => {
    const free = toCandidate({ ...race, bonus:0 });
    expect(free.reward_tier).toBe('无现金奖励');
    expect(free.reward_highlights).toEqual([]);
    expect(free.rewards).toBe('');
  });

  it('degrades safely when the api omits the numbers', () => {
    const partial = toCandidate({ raceId:9, name:'缺字段赛事' });
    expect(partial.reward_amount).toBeNull();
    expect(partial.reward_tier).toBe('暂未公布');
    expect(partial.participant_count).toBeNull();
    expect(partial.participant_unit).toBe('暂未公布');
    expect(partial.registration_start).toBeNull();
  });
});
