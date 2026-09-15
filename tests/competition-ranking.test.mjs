import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const RANKING_PATH = '../apps/miniprogram/cloudfunctions/adminData/competitionRanking.js';
const {
  WEIGHTS, accessibilityScore, completenessScore, diversify, opportunityScore, rankRecords, relevance, similarity, urgencyScore,
} = require(RANKING_PATH);
const { filterPublicRecords } = require('../apps/miniprogram/cloudfunctions/publicData/publicQuery.js');

const now = new Date('2026-09-15T00:00:00.000Z');
const days = n => new Date(now.getTime() + n * 24 * 60 * 60 * 1000).toISOString();

const record = (overrides = {}) => ({
  id:'r', name:'赛事', data_status:'published', system_validation:'passed', manual_review:'passed',
  registration_status:'报名中', registration_start:days(-10), registration_end:days(10),
  event_level:'国家级', professions:['计算机与AI'], objective_tags:[], recommendation:'值得参加',
  fee_type:'免费', registration_organization:'自行报名', lifecycle:'长期举办', region:'',
  value_scores:{ 保研考研:0, 求职就业:0, 出国留学:0, 创业融资:0 }, recognition:[], reward_highlights:[],
  scale_tier:'暂未公布', reward_amount:null, reward_tier:'暂未公布',
  ...overrides,
});

describe('weights', () => {
  it('sums to one so each dimension is a readable share', () => {
    const total = Object.values(WEIGHTS).reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('gives the goal-match dimension the largest share', () => {
    // 含金量（在用户目标路径上的认可度）是这个产品的核心判断。
    const max = Math.max(...Object.values(WEIGHTS));
    expect(WEIGHTS.goalMatch).toBe(max);
  });
});

describe('urgency is relative to the registration window', () => {
  // 长窗口赛事：报名期 90 天
  const longWindow = end => urgencyScore(record({ registration_start:days(-87), registration_end:end }), now);

  it('peaks in the window where preparation is still possible', () => {
    expect(longWindow(days(10))).toBe(1);                       // 黄金窗口
    expect(longWindow(days(45))).toBeLessThan(longWindow(days(10)));  // 太远，没有紧迫感
    expect(longWindow(days(120))).toBeLessThan(longWindow(days(45)));
  });

  it('marks a long-running contest down once the user has left it too late', () => {
    // 报名期 90 天只剩 3 天，多半来不及准备。
    expect(longWindow(days(3))).toBeLessThan(longWindow(days(10)));
  });

  it('does not punish a short-window contest for having few days left', () => {
    // 同样是「剩 3 天」，报名期只有 7 天的赛事正处在它的正常节奏里。
    // 按绝对天数一刀切，会把最容易错过的新赛事压到列表底部。
    const shortWindow = urgencyScore(record({ registration_start:days(-4), registration_end:days(3) }), now);
    expect(shortWindow).toBe(1);
    expect(shortWindow).toBeGreaterThan(longWindow(days(3)));
  });

  it('scores an unscheduled contest below an open one', () => {
    expect(urgencyScore(record({ registration_status:'时间待公布' }), now))
      .toBeLessThan(urgencyScore(record(), now));
  });
});

describe('opportunity: newly created contests few people know about', () => {
  const firstEdition = extra => record({
    lifecycle:'首届', registration_start:days(-4), registration_end:days(3), ...extra,
  });

  it('lifts a backed first edition that has no history to be recognized for', () => {
    // 首届必然没有认可度记录，goalMatch 一定是 0。没有这一维，
    // 「刚办、知道的人少、奖励丰厚」会被结构性地埋掉。
    expect(opportunityScore(firstEdition({ reward_amount:280000 }))).toBe(1);
    expect(opportunityScore(firstEdition({ reward_highlights:['实习或直通面试'] }))).toBe(1);
  });

  it('gives a first edition nothing when no one is backing it', () => {
    // 水赛也全是首届 —— 首届本身不是优点。
    expect(opportunityScore(firstEdition())).toBe(0.4);
    expect(opportunityScore(firstEdition({ reward_highlights:['证书荣誉'] }))).toBe(0.4);
  });

  it('keeps established contests at a neutral baseline', () => {
    expect(opportunityScore(record({ lifecycle:'长期举办' }))).toBe(0.4);
  });

  it('ranks a rich short-window first edition above a routine ongoing contest', () => {
    const newcomer = firstEdition({ id:'newcomer', name:'新办高奖赛事', reward_amount:280000, reward_tier:'10万-50万' });
    const routine = record({ id:'routine', name:'常规赛事', registration_start:days(-40), registration_end:days(40) });
    expect(rankRecords([routine, newcomer], {}, now).map(item => item.id)[0]).toBe('newcomer');
  });
});

describe('no single key dominates the ranking', () => {
  it('lets a strong match on later-registration beat a weak open contest', () => {
    // 级联排序做不到这一点：报名状态会一票否决后面所有维度。
    const upcoming = record({
      id:'upcoming', name:'即将报名的好赛事', registration_status:'即将报名',
      registration_start:days(5), registration_end:days(30),
      recommendation:'强烈推荐', value_scores:{ 保研考研:9, 求职就业:0, 出国留学:0, 创业融资:0 },
    });
    const openButWeak = record({
      id:'open', name:'报名中的弱赛事', recommendation:'谨慎报名', fee_type:'收费',
      registration_organization:'需先校内选拔',
    });
    const order = rankRecords([openButWeak, upcoming], { targetPath:'保研考研' }, now).map(item => item.id);
    expect(order[0]).toBe('upcoming');
  });

  it('still prefers the open contest when everything else is equal', () => {
    const open = record({ id:'open', name:'A报名中' });
    const upcoming = record({ id:'upcoming', name:'B即将报名', registration_status:'即将报名', registration_start:days(5) });
    expect(rankRecords([upcoming, open], {}, now).map(item => item.id)[0]).toBe('open');
  });

  it('reports every dimension so a ranking can be explained', () => {
    const { score, parts } = relevance(record(), {}, now);
    expect(Object.keys(parts).sort()).toEqual(Object.keys(WEIGHTS).sort());
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe('supporting dimensions', () => {
  it('rewards a lower barrier to entry', () => {
    expect(accessibilityScore(record({ fee_type:'免费', registration_organization:'自行报名', scale_tier:'千人以下' })))
      .toBeGreaterThan(accessibilityScore(record({ fee_type:'收费', registration_organization:'需先校内选拔' })));
  });

  it('pushes records with missing fields down', () => {
    const full = record({ participants:'本科生', eligibility:'在校生', format_and_rules:'线上', team_size:'3人', registration_method:'官网', fees:'免费', rewards:'保研加分', participant_scale:'约2000队' });
    expect(completenessScore(full)).toBeGreaterThan(completenessScore(record()));
    const order = rankRecords([record({ id:'sparse', name:'资料残缺' }), { ...full, id:'full', name:'资料齐全' }], {}, now);
    expect(order[0].id).toBe('full');
  });
});

describe('diversity re-ranking', () => {
  it('measures overlap between contests', () => {
    const a = record({ professions:['计算机与AI'], objective_tags:['创新'] });
    const b = record({ professions:['计算机与AI'], objective_tags:['创新'] });
    const c = record({ professions:['机械与自动化'], objective_tags:['工程'] });
    expect(similarity(a, b)).toBe(1);
    expect(similarity(a, c)).toBe(0);
  });

  it('breaks up a block of near-identical contests', () => {
    // 否则前十条会全是同一专业，其他专业的用户根本翻不到自己的。
    const scored = [
      { item:record({ id:'cs1', professions:['计算机与AI'] }), score:0.90 },
      { item:record({ id:'cs2', professions:['计算机与AI'] }), score:0.89 },
      { item:record({ id:'cs3', professions:['计算机与AI'] }), score:0.88 },
      { item:record({ id:'mech', professions:['机械与自动化'] }), score:0.80 },
    ];
    const order = diversify(scored).map(entry => entry.item.id);
    expect(order[0]).toBe('cs1');
    // 机械那条相关度最低，但因为和前面不重复，被提到了第二位。
    expect(order[1]).toBe('mech');
  });

  it('can be switched off for callers that need the raw order', () => {
    const scored = [
      record({ id:'cs1', professions:['计算机与AI'], recommendation:'强烈推荐' }),
      record({ id:'cs2', professions:['计算机与AI'], recommendation:'强烈推荐' }),
      record({ id:'mech', professions:['机械与自动化'], recommendation:'谨慎报名' }),
    ];
    const raw = rankRecords(scored, { diversify:false }, now).map(item => item.id);
    expect(raw.slice(0, 2).sort()).toEqual(['cs1', 'cs2']);
  });
});

describe('closed and defunct contests are filtered, not demoted', () => {
  it('removes a closed registration from the default list', () => {
    const closed = record({ id:'closed', registration_start:days(-60), registration_end:days(-1) });
    expect(filterPublicRecords([closed], {}, now).items).toHaveLength(0);
    // 明确筛选「已截止」时仍然可以查到。
    expect(filterPublicRecords([closed], { registrationStatus:'已截止' }, now).items).toHaveLength(1);
  });
});

describe('deployment safety', () => {
  it('keeps both cloud functions on a byte-identical copy of the ranker', () => {
    const admin = fs.readFileSync(new URL(RANKING_PATH, import.meta.url), 'utf8');
    const publicCopy = fs.readFileSync(new URL('../apps/miniprogram/cloudfunctions/publicData/competitionRanking.js', import.meta.url), 'utf8');
    expect(publicCopy).toBe(admin);
  });
});
