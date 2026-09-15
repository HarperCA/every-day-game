import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const VALUE_PATH = '../apps/miniprogram/cloudfunctions/adminData/competitionValue.js';
const { MAX_VALUE_SCORE, normalizeRecognition, valueFields, valueScores } = require(VALUE_PATH);
const { toPublicCache } = require('../apps/miniprogram/cloudfunctions/adminData/publicCache.js');
const { filterPublicRecords } = require('../apps/miniprogram/cloudfunctions/publicData/publicQuery.js');

const recognized = (path, level, evidence, scope) => ({ path, level, evidence, ...(scope ? { scope } : {}) });

describe('per-path recognition scoring', () => {
  it('scores nothing when no value data is known', () => {
    // 现有 30 条全是空值，加字段不能改变它们的排序。
    expect(valueScores({})).toEqual({ 保研考研:0, 求职就业:0, 出国留学:0, 创业融资:0 });
  });

  it('keeps recognition separate per path instead of collapsing it', () => {
    // 同一场赛事考研导师认可、企业 HR 未必认可 —— 不能压成一个标量。
    const academic = valueScores({ recognition:[recognized('保研考研', '高', '入选高教学会竞赛目录')] });
    expect(academic.保研考研).toBeGreaterThan(0);
    expect(academic.求职就业).toBe(0);
  });

  it('honors the job scope so one role does not inherit another role recognition', () => {
    const icpc = { recognition:[
      recognized('求职就业', '高', '大厂算法岗普遍认可奖牌', ['算法工程师', '后端研发']),
      recognized('保研考研', '高', '入选高教学会竞赛目录'),
    ] };
    expect(valueScores(icpc, { scope:'算法工程师' }).求职就业).toBeGreaterThan(0);
    // 产品经理岗不在 scope 内，求职价值归零；但无 scope 的保研认可仍然成立。
    expect(valueScores(icpc, { scope:'产品经理' }).求职就业).toBe(0);
    expect(valueScores(icpc, { scope:'产品经理' }).保研考研).toBeGreaterThan(0);
  });

  it('ranks a zero-prize recognized contest above a rich unrecognized one', () => {
    // 数学建模没有奖金但保研加分；营销赛开五万奖金却没有含金量。
    const mathModeling = valueScores({ recognition:[recognized('保研考研', '高', '竞赛目录收录')], rewardHighlights:['保研考研加分'] });
    const commercial = valueScores({ rewardAmount:500000, rewardTier:'50万以上', scaleTier:'千人以下' });
    expect(mathModeling.保研考研).toBeGreaterThan(Math.max(...Object.values(commercial)));
    expect(Object.values(commercial).every(score => score === 0)).toBe(true);
  });

  it('routes each non-cash reward to the path it actually serves', () => {
    const scores = valueScores({ recognition:[recognized('求职就业', '低', '企业主办')], rewardHighlights:['实习或直通面试'] });
    expect(scores.求职就业).toBeGreaterThan(0);
    expect(scores.保研考研).toBe(0); // 直通面试对保研没有帮助
  });

  it('lets cash contribute at most one point', () => {
    const base = { recognition:[recognized('保研考研', '高', '竞赛目录收录')] };
    const withCash = valueScores({ ...base, rewardAmount:9000000 }).保研考研;
    expect(withCash - valueScores(base).保研考研).toBe(1);
  });

  it('rewards scarcity only on paths that already carry value', () => {
    // 「没人参加的无名赛事」不该因为冷门就被顶到前面。
    expect(valueScores({ scaleTier:'千人以下' }).保研考研).toBe(0);
    const scarce = valueScores({ recognition:[recognized('保研考研', '低', '省级学会主办')], scaleTier:'千人以下' });
    const crowded = valueScores({ recognition:[recognized('保研考研', '低', '省级学会主办')], scaleTier:'10万以上' });
    expect(scarce.保研考研).toBeGreaterThan(crowded.保研考研);
  });

  it('drops recognition claims that carry no evidence', () => {
    // 没有出处的认可无法复核，和 AI 审核的取证要求保持一致。
    expect(normalizeRecognition([{ path:'保研考研', level:'高' }])).toEqual([]);
    expect(normalizeRecognition([{ path:'伪造路径', level:'高', evidence:'x' }])).toEqual([]);
  });

  it('keeps only the strongest claim per path and caps the score', () => {
    const merged = normalizeRecognition([
      recognized('保研考研', '低', '弱证据'),
      recognized('保研考研', '高', '强证据'),
    ]);
    expect(merged).toEqual([{ path:'保研考研', level:'高', evidence:'强证据', scope:[] }]);
    const maxed = valueScores({
      recognition:[recognized('求职就业', '高', '龙头企业主办')],
      rewardHighlights:['实习或直通面试'], scaleTier:'千人以下', rewardAmount:1000000,
    });
    expect(maxed.求职就业).toBe(MAX_VALUE_SCORE);
  });

  it('normalizes unusable values instead of trusting them', () => {
    const fields = valueFields({ rewardAmount:'很多钱', participantCount:-5, rewardTier:'不存在的档位', lifecycle:null });
    expect(fields.reward_amount).toBeNull();
    expect(fields.participant_count).toBeNull();
    expect(fields.reward_tier).toBe('暂未公布');
    expect(fields.lifecycle).toBe('暂未明确');
  });

  it('keeps both cloud functions on a byte-identical copy of the scorer', () => {
    // 两个云函数目录各自独立部署，副本一旦漂移，排序会在前后台给出不同结果。
    const admin = fs.readFileSync(new URL(VALUE_PATH, import.meta.url), 'utf8');
    const publicCopy = fs.readFileSync(new URL('../apps/miniprogram/cloudfunctions/publicData/competitionValue.js', import.meta.url), 'utf8');
    expect(publicCopy).toBe(admin);
  });
});

const publishable = {
  id:'edition-1', eventId:'event-1', name:'测试竞赛', editionName:'测试竞赛（2026）', aliases:[], organizer:'测试组委会',
  eventLevel:'国家级', professions:['计算机与AI'], objectiveTags:[], participationFormat:'团队赛', teamSizeCategory:'2～3人',
  feeType:'免费', registrationOrganization:'自行报名', registrationUrl:'https://example.com/register',
  schedule:{ registration_start:'2026-08-01T00:00:00.000Z', registration_end:'2026-09-30T00:00:00.000Z', status_override:null },
  recommendation:{ recommendation:'值得参加', reasons:[] }, lastVerifiedAt:'2026-08-30T00:00:00.000Z',
  sources:[{ id:'source-1', source_type:'authority_notice', is_official:true, validity_status:'valid', url:'https://example.com/notice' }],
  dataStatus:'published', systemValidation:'passed', manualReview:'passed',
};
const at = new Date('2026-08-31T00:00:00.000Z');

describe('value fields in the public cache', () => {
  it('publishes safe defaults so existing records are unaffected', () => {
    expect(toPublicCache(publishable, at)).toMatchObject({
      reward_amount:null, reward_tier:'暂未公布', reward_highlights:[], participant_count:null,
      scale_tier:'暂未公布', region:'', lifecycle:'暂未明确', recognition:[],
      value_scores:{ 保研考研:0, 求职就业:0, 出国留学:0, 创业融资:0 },
    });
  });

  it('keeps the cached sort weight independent of any single path', () => {
    // 价值分是分路径的，压进缓存里的标量会让所有用户看到同一个顺序。
    const plain = toPublicCache(publishable, at).sort_weight;
    const valuable = toPublicCache({ ...publishable, recognition:[recognized('保研考研', '高', '竞赛目录收录')] }, at).sort_weight;
    expect(valuable).toBe(plain);
  });
});

describe('query-time ranking by the user goal', () => {
  const cached = record => toPublicCache(record, at);
  const academic = cached({ ...publishable, id:'academic', name:'学术型赛事', recognition:[recognized('保研考研', '高', '竞赛目录收录')] });
  const career = cached({ ...publishable, id:'career', name:'求职型赛事', recognition:[recognized('求职就业', '高', '龙头企业主办', ['算法工程师'])] });
  const records = [career, academic];

  it('puts the contest matching the chosen path first', () => {
    expect(filterPublicRecords(records, { targetPath:'保研考研' }, at).items[0].id).toBe('academic');
    expect(filterPublicRecords(records, { targetPath:'求职就业' }, at).items[0].id).toBe('career');
  });

  it('re-scores against the target job so an unrelated role loses the bonus', () => {
    const asAlgorithm = filterPublicRecords(records, { targetPath:'求职就业', targetScope:'算法工程师' }, at).items;
    expect(asAlgorithm[0].id).toBe('career');
    // 产品经理岗拿不到算法岗的认可，两条记录回到同分，按名称排序。
    const asProduct = filterPublicRecords(records, { targetPath:'求职就业', targetScope:'产品经理' }, at).items;
    expect(asProduct.map(item => item.id).sort()).toEqual(['academic', 'career']);
  });

  it('hides defunct contests by default but returns them when asked for', () => {
    const closed = cached({ ...publishable, id:'closed', name:'已停办赛事', lifecycle:'已停办' });
    expect(filterPublicRecords([closed], {}, at).items).toHaveLength(0);
    expect(filterPublicRecords([closed], { lifecycle:'已停办' }, at).items).toHaveLength(1);
  });

  it('filters local contests by region', () => {
    const local = cached({ ...publishable, id:'local', name:'四川省赛', region:'四川省' });
    expect(filterPublicRecords([local, academic], { region:'四川省' }, at).items.map(item => item.id)).toEqual(['local']);
  });
});

describe('contests whose timing the school decides', () => {
  const { schoolTimingAdvice } = require('../apps/miniprogram/cloudfunctions/adminData/competitionValue.js');

  it('flags the three ways a school controls the real deadline', () => {
    // 实测 30 条里有 14 条属于这种，接近一半 —— 不是边缘情况。
    for (const organization of ['需先校内选拔', '学校统一报名', '以赛区或学校通知为准']) {
      const advice = schoolTimingAdvice({ registrationOrganization:organization });
      expect(advice.dependent).toBe(true);
      expect(advice.note).toContain('教务处');
    }
  });

  it('says nothing only when the student can enter directly', () => {
    const direct = schoolTimingAdvice({ registrationOrganization:'自行报名' });
    expect(direct.dependent).toBe(false);
    expect(direct.reliability).toBe('official');
    expect(direct.note).toBe('');
  });

  it('does not treat an unconfirmed organization as a reliable date', () => {
    // 「不知道报名怎么组织」不等于「官方日期可信」。把未确认的当成可靠，
    // 等于替主办方向用户担保一个我们没核实过的日期。
    for (const organization of ['暂未明确', '两种方式均可']) {
      const advice = schoolTimingAdvice({ registrationOrganization:organization });
      expect(advice.reliability).toBe('unverified');
      expect(advice.note).not.toBe('');
    }
    // 字段缺失同样是「不知道」，不能默认可靠。
    expect(schoolTimingAdvice({}).reliability).toBe('unverified');
  });

  it('warns that team-building may already have started', () => {
    // 校内选拔往往早几周到几个月；显示官方日期而不说明，
    // 会让用户以为还有时间，等他发现时组队早就结束了。
    const advice = schoolTimingAdvice({ registrationOrganization:'需先校内选拔' });
    expect(advice.note).toContain('组队');
    expect(advice.note).toContain('不要等到官方截止日');
  });

  it('publishes the flag and the note to the miniprogram', () => {
    const cached = toPublicCache({ ...publishable, registrationOrganization:'需先校内选拔' }, at);
    expect(cached.school_timing_dependent).toBe(true);
    expect(cached.school_timing_note).toContain('校内选拔');
    expect(cached.timing_reliability).toBe('school_controlled');
    expect(toPublicCache(publishable, at).school_timing_dependent).toBe(false);
    expect(toPublicCache(publishable, at).timing_reliability).toBe('official');
  });
});
