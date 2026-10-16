import { describe, expect, it } from 'vitest';
import { markOverdueTrace, OVERDUE_TRACE_PREFIX } from '../scripts/server/trace-expiry.mjs';

const now = new Date('2026-10-03T12:00:00+08:00');
const base = {
  id:'example', dataStatus:'draft', manualReview:'pending', systemValidation:'not_run',
  triage:{bucket:'需要追溯',traceDue:'2026-10-02T23:59:59+08:00',traceTodo:'核对主办方原文'},
  qualityIssues:['registration_time_pending'],
};

describe('追溯到期处理', () => {
  it('逾期只标注待核查，保留草稿和原审核状态', () => {
    const result = markOverdueTrace(base, now);
    expect(result.dataStatus).toBe('draft');
    expect(result.manualReview).toBe('pending');
    expect(result.systemValidation).toBe('not_run');
    expect(result.quarantine).toBeUndefined();
    expect(result.qualityIssues).toEqual(['registration_time_pending', expect.stringContaining('核对主办方原文')]);
    expect(markOverdueTrace(result, now)).toBe(result);
  });

  it('仅处理需要追溯且确实到期的草稿', () => {
    const published = {...base,dataStatus:'published'};
    expect(markOverdueTrace(published,now)).toBe(published);
    const future = {...base,triage:{...base.triage,traceDue:'2026-10-04T23:59:59+08:00'}};
    expect(markOverdueTrace(future,now)).toBe(future);
    const other = {...base,triage:{...base.triage,bucket:'待审核'}};
    expect(markOverdueTrace(other,now)).toBe(other);
  });

  it('待核查内容变更时替换旧标记，不累积重复项', () => {
    const updated = {...base,qualityIssues:[`${OVERDUE_TRACE_PREFIX}旧内容`,'registration_time_pending']};
    const result = markOverdueTrace(updated,now);
    expect(result.qualityIssues).toHaveLength(2);
    expect(result.qualityIssues[0]).toBe('registration_time_pending');
  });
});
