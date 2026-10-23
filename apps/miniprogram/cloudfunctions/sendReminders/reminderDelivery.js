const crypto = require('crypto');

const EXPECTED_TRIGGER = 'send-reminders-every-5-minutes';
// 云开发的定时触发器在本环境不执行（见 docs/admin-cloudbase.md），
// 因此额外开一个凭密钥调用的入口，由美国服务器驱动。
// 这个入口会交出用户 openid，所以密钥必须足够长，且比较必须是定长时间的。
const MIN_DISPATCH_SECRET_LENGTH = 24;
const DISPATCH_ACTIONS = ['dispatch', 'listUpcoming', 'claim', 'report'];
const DEFAULT_UPCOMING_MS = 2 * 60 * 60 * 1000;
const MAX_UPCOMING_MS = 6 * 60 * 60 * 1000;

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
  if (!event || !DISPATCH_ACTIONS.includes(event.action)) return false;
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

// 提醒文档编号（数据库 _id），只允许常见字符，防止拼进查询
function requireReminderKey(value) {
  if (typeof value !== 'string' || !/^[\w.:-]{1,128}$/.test(value)) throw new Error('invalid_reminder_key');
  return value;
}

function upcomingWindowMs(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return DEFAULT_UPCOMING_MS;
  return Math.min(ms, MAX_UPCOMING_MS);
}

function truncate(value, limit) {
  return Array.from(String(value || '')).slice(0, limit).join('');
}

function formatShanghaiTime(value) {
  const date = new Date(value);
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = part => String(part).padStart(2, '0');
  return `${local.getUTCFullYear()}年${pad(local.getUTCMonth() + 1)}月${pad(local.getUTCDate())}日 ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

// 微信“发送订阅消息”HTTP 接口的请求体（字段名用接口原样的下划线写法）
function buildSubscribePayload(item, openid, { templateId, miniprogramState } = {}) {
  return {
    touser:openid,
    template_id:item.subscription_template_id || templateId,
    page:`pages/detail/detail?id=${encodeURIComponent(item.edition_id)}`,
    miniprogram_state:miniprogramState || 'formal',
    lang:'zh_CN',
    data:{
      thing1:{ value:truncate(item.task_name || `${item.competition_name || '大学生竞赛'}·${item.event_label || '报名'}提醒`, 20) },
      time3:{ value:formatShanghaiTime(item.remind_at) },
      thing5:{ value:truncate(`请查看${item.event_label || '报名'}安排，以官方通知为准`, 20) },
    },
  };
}

module.exports = {
  MIN_DISPATCH_SECRET_LENGTH, assertScheduledInvocation, buildSubscribePayload, failureDeliveryStatus, formatShanghaiTime,
  isAuthorizedDispatch, isDeliverableScheduleStatus, isScheduledTimer, requireReminderKey, upcomingWindowMs,
};
