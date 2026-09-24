import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  backoffUntilMs, countStaleRecords, nextFailureMark, runStatus, selectStaleRecords,
  countStaleForFieldVerification, selectStaleForFieldVerification, nextFieldVerificationFailureMark,
} = require('../apps/miniprogram/cloudfunctions/adminData/aiReviewSchedule.js');

const NOW = Date.parse('2026-09-14T00:00:00.000Z');
const daysAgo = days => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

describe('ai review scheduling', () => {
  const records = [
    { id:'fresh', aiReview:{ reviewed_at:daysAgo(1) } },
    { id:'stale-3d', aiReview:{ reviewed_at:daysAgo(9) } },
    { id:'never' },
    { id:'stale-30d', aiReview:{ reviewed_at:daysAgo(30) } },
  ];

  it('reviews never-checked records before merely stale ones', () => {
    const due = selectStaleRecords(records, { now:NOW, limit:3 });
    expect(due.map(record => record.id)).toEqual(['never', 'stale-30d', 'stale-3d']);
  });

  it('leaves recently reviewed records alone', () => {
    expect(selectStaleRecords(records, { now:NOW, limit:10 }).map(r => r.id)).not.toContain('fresh');
    expect(countStaleRecords(records, { now:NOW })).toBe(3);
  });

  it('honours the batch limit so one run fits the 60s cloud function cap', () => {
    expect(selectStaleRecords(records, { now:NOW, limit:1 })).toHaveLength(1);
    expect(selectStaleRecords(records, { now:NOW, limit:0 })).toHaveLength(0);
  });

  it('ignores records without an id', () => {
    expect(selectStaleRecords([{ aiReview:null }], { now:NOW, limit:5 })).toEqual([]);
  });

  it('reports partial when records remain for the next trigger', () => {
    expect(runStatus({ selected:3, succeeded:3, failed:0, remaining:12 })).toBe('partial');
    expect(runStatus({ selected:3, succeeded:3, failed:0, remaining:0 })).toBe('completed');
  });

  it('backs a repeatedly failing record off instead of retrying it every tick', () => {
    const failing = { id:'slow', aiReviewFailure:{ count:1, lastAt:daysAgo(0) } };
    expect(selectStaleRecords([failing], { now:NOW, limit:5 })).toEqual([]);
    // 退避到期后重新排队
    const expired = { id:'slow', aiReviewFailure:{ count:1, lastAt:daysAgo(1) } };
    expect(selectStaleRecords([expired], { now:NOW, limit:5 }).map(r => r.id)).toEqual(['slow']);
  });

  it('lengthens the backoff with each failure but caps it at a week', () => {
    const at = daysAgo(0);
    expect(backoffUntilMs({ aiReviewFailure:{ count:1, lastAt:at } })).toBe(NOW + 6 * 60 * 60 * 1000);
    expect(backoffUntilMs({ aiReviewFailure:{ count:99, lastAt:at } })).toBe(NOW + 7 * 24 * 60 * 60 * 1000);
    expect(backoffUntilMs({})).toBe(0);
  });

  it('accumulates the failure count across runs', () => {
    const first = nextFailureMark({}, 'request_timeout_after_50000ms', new Date(NOW));
    expect(first.count).toBe(1);
    expect(nextFailureMark({ aiReviewFailure:first }, 'again', new Date(NOW)).count).toBe(2);
  });

  it('separates an empty run from a real failure', () => {
    expect(runStatus({ selected:0 })).toBe('idle');
    expect(runStatus({ selected:3, succeeded:0, failed:3, remaining:5 })).toBe('failed');
    expect(runStatus({ selected:3, succeeded:2, failed:1, remaining:0 })).toBe('completed');
    expect(runStatus({ selected:0, errored:true })).toBe('failed');
  });

  it('never re-reviews an archived record, even if it has never been reviewed', () => {
    const archived = { id:'gone', dataStatus:'archived' };
    expect(selectStaleRecords([archived], { now:NOW, limit:5 })).toEqual([]);
    expect(countStaleRecords([archived], { now:NOW })).toBe(0);
  });
});

// 已发布赛事的三项核验走独立的节奏（fieldVerification/fieldVerificationFailure），
// 跟上面通用复核的 aiReview/aiReviewFailure 互不干扰。
describe('field verification scheduling', () => {
  const records = [
    { id:'draft-never-reviewed', dataStatus:'draft', manualReview:'pending', schedule:{ status_override:'报名中' } },
    { id:'published-never-verified', dataStatus:'published', manualReview:'passed', schedule:{} },
    { id:'published-stale', dataStatus:'published', manualReview:'passed', schedule:{}, fieldVerification:{ reviewed_at:daysAgo(9) } },
    { id:'published-fresh', dataStatus:'published', manualReview:'passed', schedule:{}, fieldVerification:{ reviewed_at:daysAgo(1) } },
    { id:'archived', dataStatus:'archived', manualReview:'passed', schedule:{ status_override:'报名中' } },
    // 数学建模竞赛那类真实情况：人工已经通过了，只是系统验证过期重跑失败，
    // dataStatus 字面上还是 pending_manual_review，但当前显示"报名中"——
    // 这种必须照样进周检队列，不能因为字面状态不是 published 就漏掉。
    { id:'approved-but-not-yet-published-open', dataStatus:'pending_manual_review', manualReview:'passed', schedule:{ status_override:'报名中' } },
    // 同样是"没发布"，但报名已经关了——不该占核验名额，这个不是"published 记录每周维护"的活。
    { id:'approved-but-not-yet-published-closed', dataStatus:'pending_manual_review', manualReview:'passed', schedule:{ status_override:'已截止' } },
    // 人工还没通过的草稿，哪怕算出来是"报名中"，也不能绕过人工直接进自动核验/自动改。
    { id:'not-yet-approved-open', dataStatus:'pending_manual_review', manualReview:'pending', schedule:{ status_override:'报名中' } },
  ];

  it('selects published records regardless of registration status', () => {
    const due = selectStaleForFieldVerification(records, { now:NOW, limit:10 }).map(r => r.id);
    expect(due).toContain('published-never-verified');
    expect(due).toContain('published-stale');
    expect(due).not.toContain('published-fresh');
  });

  it('also selects an already-approved record that is currently open for registration, even if it was never actually published', () => {
    const due = selectStaleForFieldVerification(records, { now:NOW, limit:10 }).map(r => r.id);
    expect(due).toContain('approved-but-not-yet-published-open');
  });

  it('excludes an approved-but-unpublished record whose registration has already closed', () => {
    const due = selectStaleForFieldVerification(records, { now:NOW, limit:10 }).map(r => r.id);
    expect(due).not.toContain('approved-but-not-yet-published-closed');
  });

  it('never includes a record a human has not approved yet, even if it looks open for registration', () => {
    const due = selectStaleForFieldVerification(records, { now:NOW, limit:10 }).map(r => r.id);
    expect(due).not.toContain('draft-never-reviewed');
    expect(due).not.toContain('not-yet-approved-open');
  });

  it('never re-verifies an archived record', () => {
    const due = selectStaleForFieldVerification(records, { now:NOW, limit:10 }).map(r => r.id);
    expect(due).not.toContain('archived');
  });

  it('counts the same set selectStaleForFieldVerification would return', () => {
    expect(countStaleForFieldVerification(records, { now:NOW })).toBe(selectStaleForFieldVerification(records, { now:NOW, limit:99 }).length);
  });

  it('backs off a repeatedly-failing record independently of the general aiReviewFailure counter', () => {
    const failing = { id:'p', dataStatus:'published', manualReview:'passed', schedule:{}, fieldVerificationFailure:{ count:1, lastAt:daysAgo(0) }, aiReviewFailure:null };
    expect(selectStaleForFieldVerification([failing], { now:NOW, limit:5 })).toEqual([]);
  });

  it('accumulates its own failure count, separate from nextFailureMark', () => {
    const first = nextFieldVerificationFailureMark({}, 'timeout', new Date(NOW));
    expect(first.count).toBe(1);
    expect(nextFieldVerificationFailureMark({ fieldVerificationFailure:first }, 'again', new Date(NOW)).count).toBe(2);
  });
});
