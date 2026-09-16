import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { assessAdmission, admissionSignals, isSchoolOnly } = require('../apps/miniprogram/cloudfunctions/adminData/competitionAdmission.js');

describe('obscure is not the same as worthless', () => {
  it('never rejects a contest for being small or unknown', () => {
    // 冷门正是产品要找的目标。把规模当拒收依据，等于挡掉最有价值的那批。
    const obscure = {
      organizer:'某小众专业委员会',
      introduction:'首届赛事，面向特定方向的在校学生。',
      participant_count:23, scale_tier:'千人以下',
    };
    expect(assessAdmission(obscure).verdict).not.toBe('reject');
  });

  it('admits a tiny contest that carries real recognition', () => {
    const tiny = {
      organizer:'某专业委员会',
      participant_count:40,
      recognition:[{ path:'求职就业', level:'高', evidence:'该方向头部企业招聘明确认可', scope:['芯片设计'] }],
    };
    expect(assessAdmission(tiny).verdict).toBe('admit');
  });
});

describe('detecting a worthless contest', () => {
  it('rejects the classic pay-to-win pattern', () => {
    const mill = {
      organizer:'某教育科技有限公司',
      introduction:'人人有奖，保证获奖，证书可查询需缴纳工本费。',
      registration_method:'滚动报名，每月一期。',
    };
    const result = assessAdmission(mill);
    expect(result.verdict).toBe('reject');
    expect(result.redFlags).toContain('宣称人人有奖');
  });

  it('rejects a contest advertising an absurd award rate', () => {
    const result = assessAdmission({ introduction:'获奖率 95%，含金量极高，保研必备。' });
    expect(result.verdict).toBe('reject');
  });

  it('does not reject a red-flagged contest that also has real backing', () => {
    // 正规赛事也可能用「常年招生」这类措辞；有权威背书时不该一票否决。
    const mixed = {
      organizer:'中国计算机学会',
      introduction:'由教育部指导，全国组委会主办。滚动报名，随时报名。',
    };
    expect(assessAdmission(mixed).verdict).toBe('admit');
  });

  it('treats a paid entry fee as neutral, not as proof of a scam', () => {
    // 不少正规赛事收报名费；不少水赛反而免费，靠后续培训收费。
    const paid = { organizer:'中国自动化学会', fees:'每队报名费 200 元', introduction:'全国组委会统一组织。' };
    expect(assessAdmission(paid).verdict).toBe('admit');
  });
});

describe('school-only contests are out of scope', () => {
  it('excludes a contest that only its own school runs', () => {
    // 学生对自己学校的赛事本来就知情，雷达没有增量价值。
    const internal = {
      tier:'校级', organizer:'某大学教务处',
      introduction:'面向我校在校生的程序设计竞赛。',
    };
    expect(assessAdmission(internal).verdict).toBe('out_of_scope');
  });

  it('keeps a school round that feeds a larger contest', () => {
    // 校内选拔是国赛的第一个环节，而且往往比国赛报名早两个月 ——
    // 漏掉它，用户看到的国赛日期就是他已经没资格用的日期。
    const qualifier = {
      tier:'校级', parentEventId:'event-cmp004', organizer:'某大学教务处',
      introduction:'全国大学生数学建模竞赛校内选拔赛。',
    };
    expect(assessAdmission(qualifier).verdict).not.toBe('out_of_scope');
    expect(isSchoolOnly(qualifier)).toBe(false);
  });

  it('never excludes provincial or national tiers', () => {
    expect(assessAdmission({ tier:'省级', organizer:'四川省教育厅' }).verdict).not.toBe('out_of_scope');
    expect(assessAdmission({ tier:'全国', organizer:'教育部高等教育司' }).verdict).toBe('admit');
  });

  it('does not exclude a record whose tier is unknown', () => {
    // 层级缺失时不能当成校级，否则会误杀还没标注层级的记录。
    expect(assessAdmission({ organizer:'中国图象图形学学会' }).verdict).not.toBe('out_of_scope');
  });
});

describe('default verdict', () => {
  it('sends anything without evidence to review rather than guessing', () => {
    // review 是默认档，不是失败：误拒一个好赛事没人会发现。
    const unknown = { organizer:'某公司', introduction:'一场面向开发者的挑战赛。' };
    const result = assessAdmission(unknown);
    expect(result.verdict).toBe('review');
    expect(result.reason).toContain('需要');
  });

  it('handles an empty record without throwing', () => {
    expect(assessAdmission({}).verdict).toBe('review');
    expect(assessAdmission().verdict).toBe('review');
  });
});

describe('evidence reporting', () => {
  it('lists the signals behind every verdict so a decision can be checked', () => {
    const signals = admissionSignals({
      organizer:'中国图象图形学学会',
      reward_highlights:['实习或直通面试', '现金奖金'],
    });
    expect(signals.positives.join()).toContain('学会');
    // 现金和证书不算「实质回报」，直通面试才算。
    expect(signals.positives.join()).toContain('实习或直通面试');
    expect(signals.positives.join()).not.toContain('现金奖金');
  });

  it('counts a verified recognition claim as the strongest evidence', () => {
    const withoutClaim = admissionSignals({ organizer:'某公司' }).score;
    const withClaim = admissionSignals({
      organizer:'某公司',
      recognition:[{ path:'保研考研', level:'高', evidence:'入选竞赛目录' }],
    }).score;
    expect(withClaim).toBeGreaterThan(withoutClaim + 3);
  });

  it('ignores a recognition claim that was never verified to a level', () => {
    const vague = admissionSignals({ recognition:[{ path:'保研考研', level:'暂未明确', evidence:'待核实' }] });
    expect(vague.score).toBe(0);
  });
});

describe('the real crawled candidates', () => {
  const report = require('../reports/tianchi-candidates.json');

  it('admits the contests backed by a national academic society', () => {
    const byName = name => report.candidates.find(item => item.name.includes(name));
    expect(assessAdmission(byName('CSIG')).verdict).toBe('admit');
    expect(assessAdmission(byName('SMP')).verdict).toBe('admit');
  });

  it('rejects none of them outright, since none advertises worthless-contest patterns', () => {
    const verdicts = report.candidates.map(item => assessAdmission(item).verdict);
    expect(verdicts).not.toContain('reject');
    expect(verdicts).toContain('review');
  });
});

describe('a verified non-cash reward is enough on its own', () => {
  it('admits a contest whose only evidence is a quote-backed interview fast track', () => {
    // 实习直通面试、保研加分正是这个产品要找的东西，而且它们是抽取时
    // 逐字引证过的原文事实，比关键词扫出来的「名字里有学会」更硬。
    const result = assessAdmission({ reward_highlights:['现金奖金', '实习或直通面试', '证书荣誉'] });
    expect(result.verdict).toBe('admit');
    expect(result.positives.join()).toContain('实习或直通面试');
  });

  it('does not admit on cash, certificates or merchandise alone', () => {
    // 这三样几乎每个赛事都有，不构成价值证据。
    expect(assessAdmission({ reward_highlights:['现金奖金', '证书荣誉', '实物奖品'] }).verdict).toBe('review');
  });

  it('keeps sibling tracks of one contest on the same verdict', () => {
    // 实测：欧莱雅黑客松三个赛题正文对实习直通面试写法完全相同，
    // 但模型只在其中一条给出了 recognition_hints。若认可度是唯一决定因素，
    // 同一个赛事家族会因为模型抖动被拆成 admit 和 review 两种结果。
    const withHint = assessAdmission({
      reward_highlights:['实习或直通面试'],
      recognition:[{ path:'求职就业', level:'中', evidence:'表现优异的参赛团队将有机会获得欧莱雅暑期实习直通面试机会' }],
    }).verdict;
    const withoutHint = assessAdmission({ reward_highlights:['实习或直通面试'] }).verdict;
    expect(withoutHint).toBe(withHint);
  });
});
