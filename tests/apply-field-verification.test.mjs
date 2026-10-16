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

describe('applyFieldVerification — AI suggestions remain pending human evidence review', () => {
  it('keeps a draft and unverified sources even when all three AI checks pass', () => {
    const verification = {
      all_correct: true, name_correct: true,
      registration_start_status: 'confirmed_correct', registration_end_status: 'confirmed_correct', registration_url_correct: true,
      professions_confident: true, professions: ['计算机与AI'],
    };
    const result = applyFieldVerification(draftRecord(), verification, now);
    expect(result.dataStatus).toBe('draft');
    expect(result.manualReview).toBe('pending');
    expect(result.systemValidation).toBe('not_run');
    expect(result.sources[0].is_official).toBe(false);
    expect(result.sources[0].validity_status).toBe('unchecked');
    expect(result.qualityIssues.join()).toContain('人工对照官方原文');
  });

  it('applies a usable draft correction without granting publication approval', () => {
    // 实测场景：天池链接读到正文后，名称/链接/截止时间都对，只有开始时间不对，
    // Kimi 给出了具体的修正值，但还需核实是否为该届次的官方原文。
    const verification = {
      all_correct: false,
      name_correct: true,
      registration_start_status: 'incorrect', registration_start_correction: '2026-07-19',
      registration_end_status: 'confirmed_correct', registration_end_correction: '',
      registration_url_correct: true, registration_url_correction: '',
      professions_confident: true, professions: ['计算机与AI'],
    };
    const result = applyFieldVerification(draftRecord(), verification, now);
    expect(result.dataStatus).toBe('draft');
    expect(result.schedule.registration_start).toBe('2026-07-19T00:00:00.000Z');
    expect(result.manualReview).toBe('pending');
  });

  // 用户明确要求的行为：不是一定要有报名时间，只要知道有这个比赛、即将
  // 报名就可以了——来源没写日期不该拦住发布，应该落回"时间待公布"。
  it('keeps the date as pending announcement when the source does not mention it', () => {
    const verification = {
      all_correct: true, name_correct: true,
      registration_start_status: 'not_specified', registration_end_status: 'not_specified',
      registration_url_correct: true,
      professions_confident: true, professions: ['计算机与AI'],
    };
    const result = applyFieldVerification(draftRecord(), verification, now);
    expect(result.dataStatus).toBe('draft');
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
    expect(result.dataStatus).toBe('draft');
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
    expect(result.dataStatus).toBe('draft');
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

  it('keeps a school notice and an AI-suggested registration URL as unverified evidence', () => {
    const record = draftRecord({sources:[{id:'school',url:'https://school.edu/notice',source_type:'school_notice',is_official:false,validity_status:'unchecked'}]});
    const verification = {name_correct:true,registration_start_status:'not_specified',registration_end_status:'not_specified',registration_url_correct:false,
      registration_url_correction:'https://organizer.example/entry',professions_confident:true,professions:['计算机与AI'],source_scope:'school_notice',
      evidence_status:[{url:'https://school.edu/notice',status:'reachable',chars:1000}]};
    const result = applyFieldVerification(record,verification,now);
    expect(result.dataStatus).toBe('draft');
    expect(result.registrationUrl).toBe('https://organizer.example/entry');
    expect(result.sources[0]).toEqual(record.sources[0]);
    expect(result.qualityIssues.join()).toContain('来源是否为赛事主办方');
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
