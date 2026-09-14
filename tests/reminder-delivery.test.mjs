import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { assertScheduledInvocation, failureDeliveryStatus, isDeliverableScheduleStatus } = require('../apps/miniprogram/cloudfunctions/sendReminders/reminderDelivery.js');

describe('reminder delivery worker guards', () => {
  it('allows timer invocations without a WeChat user identity', () => {
    expect(() => assertScheduledInvocation({ Type:'Timer', TriggerName:'send-reminders-every-5-minutes', Time:'2026-09-08T00:00:00Z' }, {})).not.toThrow();
  });

  it('rejects direct mini-program invocations', () => {
    const timer = { Type:'Timer', TriggerName:'send-reminders-every-5-minutes', Time:'2026-09-08T00:00:00Z' };
    expect(() => assertScheduledInvocation(timer, { OPENID:'user-openid' })).toThrow('direct_user_invocation_forbidden');
    expect(() => assertScheduledInvocation({ Type:'Timer', TriggerName:'spoofed', Time:'2026-09-08T00:00:00Z' }, {})).toThrow('scheduled_invocation_required');
  });

  it('keeps retryable failures in the due queue', () => {
    expect(failureDeliveryStatus(2, 3)).toBe('failed');
  });

  it('moves exhausted failures out of the due queue', () => {
    expect(failureDeliveryStatus(3, 3)).toBe('manual_required');
  });

  it('never delivers a reminder for a cancelled or unknown schedule', () => {
    expect(isDeliverableScheduleStatus('normal')).toBe(true);
    expect(isDeliverableScheduleStatus('time_updated')).toBe(true);
    expect(isDeliverableScheduleStatus('postponed')).toBe(true);
    expect(isDeliverableScheduleStatus('cancelled')).toBe(false);
    expect(isDeliverableScheduleStatus(undefined)).toBe(false);
  });
});
