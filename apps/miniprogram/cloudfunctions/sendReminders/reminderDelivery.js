const crypto = require('crypto');

const EXPECTED_TRIGGER = 'send-reminders-every-5-minutes';
// 云开发的定时触发器在本环境不执行（见 docs/admin-cloudbase.md），
// 因此额外开一个凭密钥调用的入口，由外部 cron 驱动。
// 这个函数会真实给用户发订阅消息，所以密钥必须足够长，且比较必须是定长时间的。
const MIN_DISPATCH_SECRET_LENGTH = 24;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isScheduledTimer(event) {
  return Boolean(event && event.Type === 'Timer' && event.TriggerName === EXPECTED_TRIGGER && event.Time);
}

// 密钥未配置或过短时一律拒绝，避免配置疏忽导致入口形同虚设。
function isAuthorizedDispatch(event, secret) {
  const expected = String(secret || '');
  if (expected.length < MIN_DISPATCH_SECRET_LENGTH) return false;
  if (!event || event.action !== 'dispatch') return false;
  return safeEqual(event.dispatchSecret, expected);
}

function assertScheduledInvocation(event, context, secret) {
  if (context && context.OPENID) throw new Error('direct_user_invocation_forbidden');
  if (isScheduledTimer(event)) return 'timer';
  if (isAuthorizedDispatch(event, secret)) return 'dispatch';
  throw new Error('scheduled_invocation_required');
}

function failureDeliveryStatus(retryCount, maxRetries) {
  return retryCount >= maxRetries ? 'manual_required' : 'failed';
}

function isDeliverableScheduleStatus(status) {
  return status === 'normal' || status === 'time_updated' || status === 'postponed';
}

module.exports = { MIN_DISPATCH_SECRET_LENGTH, assertScheduledInvocation, failureDeliveryStatus, isAuthorizedDispatch, isDeliverableScheduleStatus, isScheduledTimer };
