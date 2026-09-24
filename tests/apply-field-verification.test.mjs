import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { applyFieldVerification } = require('../apps/miniprogram/cloudfunctions/adminData/intakeSchedule.js');

function draftRecord(overrides = {}) {
  return {
    id: 'edition-x', name: '某某挑战赛', qualityIssues: [],
    schedule: { registration_start: null, registration_end: '2026-09-01T00:00:00.000Z' },
    registrationUrl: 'https://example.com/old',
    sources: [{ id: 's1', url: 'https://example.com/old', is_official: false, validity_status: 'unchecked' }],
    ...overrides,
  };
}

const now = new Date('2026-09-19T00:00:00.000Z');

describe('applyFieldVerification — auto-correcting a fresh draft, not just noting the problem', () => {
  it('auto-publishes when all three checks pass and professions are confident', () => {
    const verification = {
      all_correct: true, name_correct: true,
      registration_start_status: 'confirmed_correct', registration_end_status: 'confirmed_correct', registration_url_correct: true,
      professions_confident: true, professions: ['计算机与AI'],
    };
    const result = applyFieldVerification(draftRecord(), verification, now);
    expect(result.dataStatus).toBe('published');
    expect(result.manualReview).toBe('passed');
    expect(result.sources[0].is_official).toBe(true);
    expect(result.sources[0].validity_status).toBe('valid');
  });

  it('applies a usable correction and still auto-publishes — this is the actual fix, not just a note', () => {
    // 实测场景：天池链接读到正文后，名称/链接/截止时间都对，只有开始时间不对，
    // 但 Kimi 给出了具体的修正值——这种情况不该卡在草稿等人工，应该直接改上去发布。
    const verification = {
      all_correct: false,
      name_correct: true,
      registration_start_status: 'incorrect', registration_start_correction: '2026-07-19',
      registration_end_status: 'confirmed_correct', registration_end_correction: '',
      registration_url_correct: true, registration_url_correction: '',
      professions_confident: true, professions: ['计算机与AI'],
    };
    const result = applyFieldVerification(draftRecord(), verification, now);
    expect(result.dataStatus).toBe('published');
    expect(result.schedule.registration_start).toBe('2026-07-19T00:00:00.000Z');
    expect(result.manualReviewReason).toContain('自动修正');
  });

  // 用户明确要求的行为：不是一定要有报名时间，只要知道有这个比赛、即将
  // 报名就可以了——来源没写日期不该拦住发布，应该落回"时间待公布"。
  it('publishes with the date cleared to "pending announcement" when the source never mentions it, instead of staying stuck', () => {
    const verification = {
      all_correct: true, name_correct: true,
      registration_start_status: 'not_specified', registration_end_status: 'not_specified',
      registration_url_correct: true,
      professions_confident: true, professions: ['计算机与AI'],
    };
    const result = applyFieldVerification(draftRecord(), verification, now);
    expect(result.dataStatus).toBe('published');
    expect(result.schedule.registration_start).toBeNull();
    expect(result.schedule.registration_end).toBeNull();
    expect(result.schedule.pending_announcement).toBe(true);
  });

  it('keeps pending_announcement false when at least the closing date is known', () => {
    const verification = {
      all_correct: true, name_correct: true,
      registration_start_status: 'not_specified', registration_end_status: 'confirmed_correct',
      registration_url_correct: true,
      professions_confident: true, professions: ['计算机与AI'],
    };
    const result = applyFieldVerification(draftRecord(), verification, now);
    expect(result.dataStatus).toBe('published');
    expect(result.schedule.registration_start).toBeNull();
    expect(result.schedule.registration_end).toBe('2026-09-01T00:00:00.000Z');
    expect(result.schedule.pending_announcement).toBe(false);
  });

  it('applies a name correction too, not just dates and the url', () => {
    const verification = {
      all_correct: false,
      name_correct: false, name_correction: '第二届某某挑战赛',
      registration_start_status: 'confirmed_correct', registration_end_status: 'confirmed_correct',
      registration_url_correct: true, registration_url_correction: '',
      professions_confident: true, professions: ['计算机与AI'],
    };
    const result = applyFieldVerification(draftRecord(), verification, now);
    expect(result.dataStatus).toBe('published');
    expect(result.name).toBe('第二届某某挑战赛');
  });

  it('stays a draft when a wrong field has no usable correction to apply', () => {
    const verification = {
      all_correct: false,
      name_correct: true,
      registration_start_status: 'incorrect', registration_start_correction: '', // Kimi 也说不清楚
      registration_end_status: 'confirmed_correct', registration_end_correction: '',
      registration_url_correct: true, registration_url_correction: '',
      professions_confident: true, professions: ['计算机与AI'],
    };
    const result = applyFieldVerification(draftRecord(), verification, now);
    expect(result.dataStatus).not.toBe('published');
    expect(result.professions).toEqual(['计算机与AI']);
    expect(result.qualityIssues.join()).toContain('给不出修正值');
  });

  it('never upgrades a discovery notice to an official source', () => {
    const verification = {name_correct:true,registration_start_status:'not_specified',registration_end_status:'not_specified',registration_url_correct:true,professions_confident:true,professions:['计算机与AI']};
    const record = draftRecord({sources:[...draftRecord().sources,{id:'notice',url:'https://school.edu/notice',source_type:'discovery_notice',is_official:false,validity_status:'unchecked'}]});
    const result = applyFieldVerification(record, verification, now);
    expect(result.sources[1]).toMatchObject({source_type:'discovery_notice',is_official:false,validity_status:'unchecked'});
  });

  it('stays a draft when professions cannot be confidently assigned, even if the three checks pass', () => {
    const verification = {
      all_correct: true, name_correct: true,
      registration_start_status: 'confirmed_correct', registration_end_status: 'confirmed_correct', registration_url_correct: true,
      professions_confident: false, professions: [],
    };
    const result = applyFieldVerification(draftRecord(), verification, now);
    expect(result.dataStatus).not.toBe('published');
    expect(result.qualityIssues.join()).toContain('无法确定适合专业');
  });

  it('never applies an unparseable date correction, treating it the same as no correction', () => {
    const verification = {
      all_correct: false, name_correct: true,
      registration_start_status: 'incorrect', registration_start_correction: '五月下旬', // 不是合法日期
      registration_end_status: 'confirmed_correct', registration_end_correction: '',
      registration_url_correct: true, registration_url_correction: '',
      professions_confident: true, professions: ['计算机与AI'],
    };
    const result = applyFieldVerification(draftRecord(), verification, now);
    expect(result.dataStatus).not.toBe('published');
    expect(result.schedule.registration_start).toBeNull();
  });

  it('never applies a non-http(s) url correction', () => {
    const verification = {
      all_correct: false, name_correct: true,
      registration_start_status: 'confirmed_correct', registration_start_correction: '',
      registration_end_status: 'confirmed_correct', registration_end_correction: '',
      registration_url_correct: false, registration_url_correction: 'javascript:alert(1)',
      professions_confident: true, professions: ['计算机与AI'],
    };
    const result = applyFieldVerification(draftRecord(), verification, now);
    expect(result.dataStatus).not.toBe('published');
    expect(result.registrationUrl).toBe('https://example.com/old');
  });
});
