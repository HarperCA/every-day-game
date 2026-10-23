import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { MIN_DISPATCH_SECRET_LENGTH, assertScheduledInvocation, failureDeliveryStatus, isAuthorizedDispatch, isDeliverableScheduleStatus, miniprogramStateOf } = require('../apps/miniprogram/cloudfunctions/sendReminders/reminderDelivery.js');

const SECRET = 'a'.repeat(MIN_DISPATCH_SECRET_LENGTH);
const dispatch = (secret = SECRET) => ({ action:'dispatch', dispatchSecret:secret });

describe('reminder delivery worker guards', () => {
  it('allows timer invocations without a WeChat user identity', () => {
    expect(() => assertScheduledInvocation({ Type:'Timer', TriggerName:'send-reminders-every-5-minutes', Time:'2026-09-08T00:00:00Z' }, {})).not.toThrow();
  });

  it('rejects direct mini-program invocations', () => {
    const timer = { Type:'Timer', TriggerName:'send-reminders-every-5-minutes', Time:'2026-09-08T00:00:00Z' };
    expect(() => assertScheduledInvocation(timer, { OPENID:'user-openid' })).toThrow('direct_user_invocation_forbidden');
    expect(() => assertScheduledInvocation({ Type:'Timer', TriggerName:'spoofed', Time:'2026-09-08T00:00:00Z' }, {})).toThrow('scheduled_invocation_required');
  });

  it('accepts an external dispatch carrying the correct secret', () => {
    expect(assertScheduledInvocation(dispatch(), {}, SECRET)).toBe('dispatch');
    expect(assertScheduledInvocation({ Type:'Timer', TriggerName:'send-reminders-every-5-minutes', Time:'2026-09-08T00:00:00Z' }, {}, SECRET)).toBe('timer');
  });

  it('rejects a dispatch with a wrong, missing or truncated secret', () => {
    expect(() => assertScheduledInvocation(dispatch('wrong'), {}, SECRET)).toThrow('scheduled_invocation_required');
    expect(() => assertScheduledInvocation(dispatch(SECRET.slice(0, -1)), {}, SECRET)).toThrow('scheduled_invocation_required');
    expect(() => assertScheduledInvocation({ action:'dispatch' }, {}, SECRET)).toThrow('scheduled_invocation_required');
  });

  it('refuses every dispatch when the secret is unset or too short', () => {
    // 配置疏忽不能让这个入口形同虚设——它会真实给用户发订阅消息。
    expect(isAuthorizedDispatch(dispatch(''), '')).toBe(false);
    expect(isAuthorizedDispatch(dispatch(), undefined)).toBe(false);
    const shortSecret = 'b'.repeat(MIN_DISPATCH_SECRET_LENGTH - 1);
    expect(isAuthorizedDispatch(dispatch(shortSecret), shortSecret)).toBe(false);
  });

  it('never lets a signed-in user reach the worker, even with a valid secret', () => {
    expect(() => assertScheduledInvocation(dispatch(), { OPENID:'user-openid' }, SECRET)).toThrow('direct_user_invocation_forbidden');
  });

  it('ignores a secret attached to a non-dispatch action', () => {
    expect(isAuthorizedDispatch({ action:'listReminders', dispatchSecret:SECRET }, SECRET)).toBe(false);
  });

  it('keeps retryable failures in the due queue', () => {
    expect(failureDeliveryStatus(2, 3)).toBe('failed');
  });

  it('moves exhausted failures out of the due queue', () => {
    expect(failureDeliveryStatus(3, 3)).toBe('manual_required');
  });

  // 正式版已发布（2026-10）：用户点提醒通知默认打开正式版，环境变量可改成开发版、体验版测试
  it('opens the released mini program by default when a user taps the notification', () => {
    expect(miniprogramStateOf(undefined)).toBe('formal');
    expect(miniprogramStateOf('')).toBe('formal');
    expect(miniprogramStateOf('typo')).toBe('formal');
    expect(miniprogramStateOf(' Developer ')).toBe('developer');
    expect(miniprogramStateOf('trial')).toBe('trial');
  });

  it('never delivers a reminder for a cancelled or unknown schedule', () => {
    expect(isDeliverableScheduleStatus('normal')).toBe(true);
    expect(isDeliverableScheduleStatus('time_updated')).toBe(true);
    expect(isDeliverableScheduleStatus('postponed')).toBe(true);
    expect(isDeliverableScheduleStatus('cancelled')).toBe(false);
    expect(isDeliverableScheduleStatus(undefined)).toBe(false);
  });
});
