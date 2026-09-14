import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { nextFeedbackRateState } = require('../apps/miniprogram/cloudfunctions/userData/feedbackRateLimit.js');

describe('feedback rate limit state', () => {
  const now = new Date('2026-08-31T01:00:00.000Z');

  it('starts a new 24-hour window', () => {
    expect(nextFeedbackRateState({}, now)).toEqual({
      feedback_rate_window_started_at:now.toISOString(),
      feedback_rate_count:1,
      updated_at:now.toISOString(),
    });
  });

  it('increments an active window without moving its start', () => {
    const start = '2026-08-30T12:00:00.000Z';
    const next = nextFeedbackRateState({ feedback_rate_window_started_at:start, feedback_rate_count:7 }, now);
    expect(next.feedback_rate_window_started_at).toBe(start);
    expect(next.feedback_rate_count).toBe(8);
  });

  it('resets after 24 hours', () => {
    const next = nextFeedbackRateState({ feedback_rate_window_started_at:'2026-08-29T01:00:00.000Z', feedback_rate_count:20 }, now);
    expect(next.feedback_rate_count).toBe(1);
    expect(next.feedback_rate_window_started_at).toBe(now.toISOString());
  });

  it('rejects the twenty-first submission in a window', () => {
    expect(() => nextFeedbackRateState({ feedback_rate_window_started_at:'2026-08-30T12:00:00.000Z', feedback_rate_count:20 }, now)).toThrow('feedback_rate_limit_exceeded');
  });

  it('rejects corrupt counters instead of silently disabling the limit', () => {
    expect(() => nextFeedbackRateState({ feedback_rate_window_started_at:'2026-08-30T12:00:00.000Z', feedback_rate_count:-1 }, now)).toThrow('invalid_feedback_rate_state');
  });
});
