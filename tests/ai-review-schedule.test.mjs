import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { backoffUntilMs, countStaleRecords, nextFailureMark, runStatus, selectStaleRecords } = require('../apps/miniprogram/cloudfunctions/adminData/aiReviewSchedule.js');

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
});
