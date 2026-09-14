import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { shouldDeleteCloudReminder, shouldPreserveCloudReminder } = require('../apps/miniprogram/cloudfunctions/userData/reminderWritePolicy.js');

describe('reminder cloud write policy', () => {
  it('never lets a stale client overwrite a sent reminder', () => {
    expect(shouldPreserveCloudReminder({ delivery_status:'sent' })).toBe(true);
  });

  it('does not let a client release an active send claim', () => {
    expect(shouldPreserveCloudReminder({ delivery_status:'queued' })).toBe(true);
  });

  it('allows an explicit retry after a failed or manual reminder', () => {
    expect(shouldPreserveCloudReminder({ delivery_status:'failed' })).toBe(false);
    expect(shouldPreserveCloudReminder({ delivery_status:'manual_required' })).toBe(false);
  });

  it('never deletes an active claim or delivered reminder during replacement', () => {
    const keepIds = new Set();
    expect(shouldDeleteCloudReminder({ id:'queued', delivery_status:'queued' }, keepIds)).toBe(false);
    expect(shouldDeleteCloudReminder({ id:'sent', delivery_status:'sent' }, keepIds)).toBe(false);
    expect(shouldDeleteCloudReminder({ id:'pending', delivery_status:'pending' }, keepIds)).toBe(true);
    expect(shouldDeleteCloudReminder({ id:'kept', delivery_status:'pending' }, new Set(['kept']))).toBe(false);
  });
});
