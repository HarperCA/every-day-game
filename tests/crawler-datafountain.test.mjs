import { describe, expect, it } from 'vitest';
import { extractNuxtBlock, toCandidate } from '../scripts/crawler/crawl-datafountain.mjs';

describe('parsing the embedded Nuxt state', () => {
  // 参数名给重复值去重是 Nuxt SSR 的常规编译输出，不是要绕过什么东西 ——
  // 这里只验证「能从这种结构里把数据取出来」，不依赖具体压缩方式。
  it('evaluates the IIFE literal and returns the first data block', () => {
    const html = `<html><body><script>window.__NUXT__=(function(a,b){return {data:[{competitions:[{id:a,title:b}],total:1}]}})(7,"示例赛事")</script></body></html>`;
    const block = extractNuxtBlock(html);
    expect(block.total).toBe(1);
    expect(block.competitions).toEqual([{ id:7, title:'示例赛事' }]);
  });

  it('returns null instead of throwing when the page has no embedded state', () => {
    expect(extractNuxtBlock('<html><body>没有数据</body></html>')).toBeNull();
  });

  it('cannot escape the sandbox to touch the real process', () => {
    // 沙箱只暴露一个空 window，不给 process/require；即使页面脚本图谋不轨也够不到这边。
    const html = `<script>window.__NUXT__=(function(){ return { data:[{ leaked: typeof process }] } })()</script>`;
    const block = extractNuxtBlock(html);
    expect(block.leaked).toBe('undefined');
  });
});

describe('mapping a DataFountain listing into a candidate', () => {
  const item = {
    id:1169, title:'AI新睿人才"星探计划"', subTitle:'算法挑战',
    reward:'90000', rewardType:1, teams:139, isOpenSignup:1,
    organizers:[{ name:' 烟台睿创微纳技术股份有限公司', role:1 }],
    tags:[{ nameCn:'图像分割' }],
  };

  it('takes the organizer straight from the listing — this site gives it, tianchi does not', () => {
    const candidate = toCandidate(item);
    expect(candidate.organizer).toBe('烟台睿创微纳技术股份有限公司');
    expect(candidate.evidence.fields).toContain('organizer');
  });

  it('fills the numeric fields the listing can actually answer', () => {
    const candidate = toCandidate(item);
    expect(candidate).toMatchObject({
      externalId:'datafountain-1169',
      reward_amount:90000, reward_tier:'1万-10万',
      participant_count:139, participant_unit:'队', scale_tier:'千人以下',
    });
  });

  it('never treats a non-cash rewardType\'s number as a real amount', () => {
    // 实测过 rewardType!==1 时 reward 字段是占位值（比如 "11"），当真金额填进去就是编造。
    const nonCash = toCandidate({ ...item, rewardType:2, reward:'11' });
    expect(nonCash.reward_amount).toBeNull();
    expect(nonCash.reward_tier).toBe('暂未公布');
  });

  it('never fills registration dates from the listing — that window is the whole event span, not signup', () => {
    // 抽查详情页证实 startTime/endTime 是比赛整体周期，真正报名截止日期写在正文里。
    const candidate = toCandidate(item);
    expect(candidate.registration_start).toBeNull();
    expect(candidate.registration_end).toBeNull();
    expect(candidate.needsReview).toContain('registration_start');
  });

  it('leaves judgment fields empty rather than guessing them', () => {
    const candidate = toCandidate(item);
    expect(candidate.recognition).toEqual([]);
    expect(candidate.region).toBe('');
    expect(candidate.lifecycle).toBe('暂未明确');
  });

  it('degrades safely when the listing omits organizers or numbers', () => {
    const bare = toCandidate({ id:9, title:'缺字段赛事' });
    expect(bare.organizer).toBe('');
    expect(bare.reward_amount).toBeNull();
    expect(bare.participant_count).toBeNull();
    expect(bare.participant_unit).toBe('暂未公布');
  });
});
