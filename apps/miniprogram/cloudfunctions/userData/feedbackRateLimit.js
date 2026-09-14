function nextFeedbackRateState(account, now, limit = 20) {
  const previousStart = new Date(account.feedback_rate_window_started_at || 0);
  const windowExpired = Number.isNaN(previousStart.getTime()) || now.getTime() - previousStart.getTime() >= 24 * 60 * 60 * 1000;
  const windowStart = windowExpired ? now : previousStart;
  const count = windowExpired ? 0 : Number(account.feedback_rate_count || 0);
  if (!Number.isFinite(count) || count < 0) throw new Error('invalid_feedback_rate_state');
  if (count >= limit) throw new Error('feedback_rate_limit_exceeded');
  return {
    feedback_rate_window_started_at:windowStart.toISOString(),
    feedback_rate_count:count + 1,
    updated_at:now.toISOString(),
  };
}

module.exports = { nextFeedbackRateState };
