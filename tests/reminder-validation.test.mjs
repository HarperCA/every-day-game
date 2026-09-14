import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { normalizeReminderInput, normalizeReminderBatch, requireReminderEventType } = require('../apps/miniprogram/cloudfunctions/userData/reminderValidation.js');

function validReminder(overrides = {}) {
  return {
    id:'reminder-1', editionId:'edition-1', competitionName:'测试赛事', taskName:'测试赛事·报名截止提醒',
    eventType:'registration_end', eventLabel:'报名截止', targetAt:'2027-01-02T00:00:00.000Z',
    advanceKey:'1d', advanceLabel:'提前1天', offsetMs:1, remindAt:'2027-01-01T00:00:00.000Z',
    authorizationStatus:'accepted', deliveryStatus:'pending', scheduleChangeStatus:'normal',
    createdAt:'2026-09-08T00:00:00.000Z', updatedAt:'2026-09-08T00:00:00.000Z',
    ...overrides,
  };
}

describe('reminder input validation', () => {
  it('derives the offset from trusted timestamps instead of the client value', () => {
    expect(normalizeReminderInput(validReminder()).offsetMs).toBe(24 * 60 * 60 * 1000);
  });

  it.each([
    ['eventType', 'arbitrary_event'],
    ['advanceKey', '2d'],
    ['authorizationStatus', 'admin'],
    ['deliveryStatus', 'unknown'],
    ['scheduleChangeStatus', 'unknown'],
  ])('rejects an invalid %s enum', (field, value) => {
    expect(() => normalizeReminderInput(validReminder({ [field]:value }))).toThrow(`invalid_${field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)}`);
  });

  it('rejects a reminder at or after its target', () => {
    expect(() => normalizeReminderInput(validReminder({ remindAt:'2027-01-02T00:00:00.000Z' }))).toThrow('invalid_remind_at');
  });

  it('requires document-safe reminder and edition IDs', () => {
    expect(() => normalizeReminderInput(validReminder({ id:'bad/id' }))).toThrow('invalid_reminder_id');
    expect(() => normalizeReminderInput(validReminder({ editionId:'bad edition' }))).toThrow('invalid_edition_id');
  });

  it('validates the replacement scope event type', () => {
    expect(requireReminderEventType('registration_start')).toBe('registration_start');
    expect(() => requireReminderEventType('other')).toThrow('invalid_event_type');
  });

  it('rejects duplicate IDs and records outside the replacement scope', () => {
    expect(() => normalizeReminderBatch([validReminder(), validReminder()])).toThrow('duplicate_reminder_id');
    expect(() => normalizeReminderBatch([validReminder({ editionId:'other' })], {
      editionId:'edition-1', eventType:'registration_end',
    })).toThrow('reminder_scope_mismatch');
  });

  it('rejects invalid retry counters and oversized free text', () => {
    expect(() => normalizeReminderInput(validReminder({ retryCount:-1 }))).toThrow('invalid_retry_count');
    expect(() => normalizeReminderInput(validReminder({ taskName:'测'.repeat(21) }))).toThrow('task_name_too_long');
    expect(() => normalizeReminderInput(validReminder({ lastError:'x'.repeat(501) }))).toThrow('last_error_too_long');
  });
});
