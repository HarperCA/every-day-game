import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { assessAdmission, admissionSignals } = require('../apps/miniprogram/cloudfunctions/adminData/competitionAdmission.js');

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
