import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { classifyFieldVerificationIssues, replaceFieldVerificationIssues } = require('../apps/miniprogram/cloudfunctions/adminData/fieldVerificationIssues.js');

const record = { schedule:{ registration_start:'2026-09-01T00:00:00+08:00', registration_end:'2026-09-30T23:59:00+08:00' } };

describe('weekly verification issue classification', () => {
  it('treats unreadable evidence as a source problem, not four incorrect fields', () => {
    const issues = classifyFieldVerificationIssues(record, { evidence_status:[{status:'unreachable',chars:0}], name_correct:false, registration_url_correct:false, registration_start_status:'not_specified' });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('来源正文未能读取');
  });
  it('keeps an unsupported precise date distinct from an incorrect date', () => {
    const issues = classifyFieldVerificationIssues(record, { evidence_status:[{status:'reachable',chars:200}], name_correct:true, registration_url_correct:true, registration_start_status:'not_specified', registration_end_status:'confirmed_correct' });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('报名开始时间在库中有精确日期');
  });
  it('identifies an actual conflict without a usable correction', () => {
    const issues = classifyFieldVerificationIssues(record, { registration_start_status:'incorrect', registration_start_correction:'九月上旬' });
    expect(issues[0]).toContain('与来源冲突');
  });
  it('distinguishes the old boolean date result from a proven incorrect date', () => {
    const issues = classifyFieldVerificationIssues(record, { registration_start_correct:false, registration_start_correction:'' });
    expect(issues[0]).toContain('旧版核验未确认');
    expect(issues[0]).not.toContain('与来源冲突');
  });
  it('does not flag a source-absent date when the stored date is empty', () => {
    expect(classifyFieldVerificationIssues({ schedule:{} }, { name_correct:true, registration_url_correct:true, registration_start_status:'not_specified', registration_end_status:'not_specified' })).toEqual([]);
  });
  it('replaces obsolete weekly labels without deleting unrelated quality issues', () => {
    const issues = replaceFieldVerificationIssues(['既有问题', 'Kimi周检发现问题但给不出可用的修正值，需人工核对', '周检：旧原因'], ['周检：新原因']);
    expect(issues).toEqual(['既有问题', '周检：新原因']);
  });
});
