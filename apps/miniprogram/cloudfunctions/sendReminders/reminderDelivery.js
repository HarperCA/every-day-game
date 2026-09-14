const EXPECTED_TRIGGER = 'send-reminders-every-5-minutes';

function assertScheduledInvocation(event, context) {
  if (context && context.OPENID) throw new Error('direct_user_invocation_forbidden');
  if (!event || event.Type !== 'Timer' || event.TriggerName !== EXPECTED_TRIGGER || !event.Time) throw new Error('scheduled_invocation_required');
}

function failureDeliveryStatus(retryCount, maxRetries) {
  return retryCount >= maxRetries ? 'manual_required' : 'failed';
}

function isDeliverableScheduleStatus(status) {
  return status === 'normal' || status === 'time_updated' || status === 'postponed';
}

module.exports = { assertScheduledInvocation, failureDeliveryStatus, isDeliverableScheduleStatus };
