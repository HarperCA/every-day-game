const cloud = require('wx-server-sdk');
const {
  assertScheduledInvocation, buildSubscribePayload, failureDeliveryStatus, isDeliverableScheduleStatus, requireReminderKey, upcomingWindowMs,
} = require('./reminderDelivery');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const command = db.command;
const TEMPLATE_ID = 'Hdc1YLawcLjHfgiAjZYF6fJMkAMTwcPCHZYqLyvo2mY';
const MAX_RETRIES = 3;
const STALE_REMINDER_MS = 24 * 60 * 60 * 1000;
const CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_UPCOMING = 200;
const INVOCATION_LOG_DOC = 'reminder_runs';
const DELIVERABLE_SCHEDULES = ['normal', 'time_updated', 'postponed'];

function truncate(value, limit) {
  return Array.from(String(value || '')).slice(0, limit).join('');
}

// 探针：记录最近一次调用，用于确认是谁在调用这个函数。
// 这个函数超时只有 3 秒，所以只做一次覆盖写，不读取历史。
async function logInvocation(event, context, outcome) {
  try {
    await db.collection('admin_state').doc(INVOCATION_LOG_DOC).set({ data:{ last:{
      at:new Date().toISOString(),
      eventType:(event && event.Type) || null,
      triggerName:(event && event.TriggerName) || null,
      action:(event && event.action) || null,
      hasOpenid:Boolean(context && context.OPENID),
      outcome,
    } } });
  } catch (error) {
    console.error('reminder invocation log failed', error);
  }
}

async function recoverTimedOutClaims(now) {
  const expiredClaimAt = new Date(now.getTime() - CLAIM_TIMEOUT_MS).toISOString();
  await db.collection('reminder').where({ delivery_status:'queued', updated_at:command.lte(expiredClaimAt) }).update({
    // 已交给发送方但没回写结果也会留下 queued，自动重试可能重复通知。
    data:{ delivery_status:'manual_required', last_error:'send_claim_timeout_delivery_unknown', updated_at:now.toISOString() },
  });
}

async function claimReminder(item, now) {
  const result = await db.collection('reminder').where({
    _id:item._id, delivery_status:item.delivery_status, authorization_status:'accepted',
    remind_at:item.remind_at, schedule_change_status:item.schedule_change_status,
    ...(item.updated_at ? { updated_at:item.updated_at } : {}),
  }).update({
    data:{ delivery_status:'queued', updated_at:now.toISOString() },
  });
  return Boolean(result.stats && result.stats.updated === 1);
}

async function readReminder(key) {
  try {
    const result = await db.collection('reminder').doc(key).get();
    return result.data ? { ...result.data, _id:result.data._id || key } : null;
  } catch (error) {
    if (error && (error.errCode === -1 || /not exist|not found/i.test(error.message || ''))) return null;
    throw error;
  }
}

// 2026-10-24 起：云函数经 HTTP 访问服务触发时用不了云调用（subscribeMessage.send 报 -501001 invalid wx openapi access_token），
// 所以这里只管提醒数据，真正发微信由美国服务器的 reminder-dispatcher 用小程序凭证完成：
//   listUpcoming：列出接下来一段时间要到期（含过期 24 小时内没发出）的提醒，供美国服务器排计划和对账；
//   claim：到点时领取一条提醒，校验仍然有效后标成 queued，交回发送内容（含 openid）；
//   report：回写发送结果。
async function listUpcoming(now, event) {
  const until = new Date(now.getTime() + upcomingWindowMs(event.withinMs)).toISOString();
  const since = new Date(now.getTime() - STALE_REMINDER_MS).toISOString();
  const result = await db.collection('reminder').where({
    authorization_status:'accepted',
    delivery_status:command.in(['pending', 'failed']),
    schedule_change_status:command.in(DELIVERABLE_SCHEDULES),
    remind_at:command.lte(until),
  }).orderBy('remind_at', 'asc').limit(MAX_UPCOMING).get();
  // 过期超过 24 小时的交给 claim 标成 expired，这里也一并列出，让发送方去领取一次以便清理
  return { items:result.data.map(item => ({ key:item._id, remindAt:item.remind_at, stale:item.remind_at < since })) };
}

async function claim(now, event) {
  const item = await readReminder(requireReminderKey(event.key));
  if (!item) return { status:'missing' };
  if (item.authorization_status !== 'accepted' || !['pending', 'failed'].includes(item.delivery_status)
    || !isDeliverableScheduleStatus(item.schedule_change_status)) {
    return { status:'skip', reason:`state_${item.authorization_status}_${item.delivery_status}_${item.schedule_change_status}` };
  }
  const remindAt = new Date(item.remind_at).getTime();
  // 提醒时间改到以后了：告诉发送方按新时间重排（允许 5 秒时钟误差）
  if (remindAt > now.getTime() + 5000) return { status:'reschedule', remindAt:item.remind_at };
  const retries = Number(item.retry_count || 0);
  if (retries >= MAX_RETRIES) {
    await db.collection('reminder').doc(item._id).update({ data:{ delivery_status:'manual_required', updated_at:now.toISOString() } });
    return { status:'skip', reason:'retries_exhausted' };
  }
  if (now.getTime() - remindAt > STALE_REMINDER_MS) {
    await db.collection('reminder').doc(item._id).update({ data:{ delivery_status:'expired', updated_at:now.toISOString() } });
    return { status:'skip', reason:'expired' };
  }
  const user = await db.collection('user_account').doc(item.user_id).get().catch(() => ({ data:null }));
  if (!user.data || !user.data.openid) {
    const retryCount = retries + 1;
    await db.collection('reminder').doc(item._id).update({ data:{
      delivery_status:failureDeliveryStatus(retryCount, MAX_RETRIES), retry_count:retryCount, last_error:'user_openid_not_found', updated_at:now.toISOString(),
    } });
    return { status:'skip', reason:'user_openid_not_found' };
  }
  if (!await claimReminder(item, now)) return { status:'skip', reason:'claim_conflict' };
  return {
    status:'ready',
    payload:buildSubscribePayload(item, user.data.openid, { templateId:TEMPLATE_ID, miniprogramState:process.env.MINIPROGRAM_STATE }),
  };
}

async function report(now, event) {
  const item = await readReminder(requireReminderKey(event.key));
  if (!item) return { status:'missing' };
  // 只回写本轮领取过的提醒，防止旧结果覆盖用户新改的提醒
  if (item.delivery_status !== 'queued') return { status:'ignored', reason:`state_${item.delivery_status}` };
  if (event.ok === true) {
    await db.collection('reminder').doc(item._id).update({ data:{ delivery_status:'sent', sent_at:now.toISOString(), last_error:null, updated_at:now.toISOString() } });
    return { status:'sent' };
  }
  const retryCount = Number(item.retry_count || 0) + 1;
  const deliveryStatus = event.uncertain === true ? 'manual_required' : failureDeliveryStatus(retryCount, MAX_RETRIES);
  await db.collection('reminder').doc(item._id).update({ data:{
    delivery_status:deliveryStatus, retry_count:retryCount, last_error:truncate(event.error || 'subscribe_message_send_failed', 500), updated_at:now.toISOString(),
  } });
  return { status:deliveryStatus };
}

// 经腾讯云 HTTP 访问服务（/send-reminders）调用时，参数在 event.body（JSON 字符串）里。
function readParams(event) {
  if (!event || typeof event.body !== 'string') return event;
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try { return JSON.parse(raw || '{}') || {}; } catch { return {}; }
}

exports.main = async rawEvent => {
  const event = readParams(rawEvent);
  const wxContext = cloud.getWXContext();
  let via;
  try {
    via = assertScheduledInvocation(event, wxContext, process.env.DISPATCH_SECRET);
  } catch (error) {
    await logInvocation(event, wxContext, `rejected:${error && error.message}`);
    throw error;
  }
  await logInvocation(event, wxContext, `accepted:${via}`);
  const now = new Date();
  await recoverTimedOutClaims(now);
  if (event.action === 'listUpcoming') return listUpcoming(now, event);
  if (event.action === 'claim') return claim(now, event);
  if (event.action === 'report') return report(now, event);
  // 旧的 dispatch 和定时触发：不再在这里发送（见上方说明），只做超时回收。
  return { delegated:true };
};
