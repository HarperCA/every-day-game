const cloud = require('wx-server-sdk');
const { assertScheduledInvocation, failureDeliveryStatus, isDeliverableScheduleStatus, miniprogramStateOf } = require('./reminderDelivery');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const command = db.command;
const TEMPLATE_ID = 'Hdc1YLawcLjHfgiAjZYF6fJMkAMTwcPCHZYqLyvo2mY';
const configuredBatchSize = Number(process.env.REMINDER_BATCH_SIZE || 1);
const BATCH_SIZE = Number.isInteger(configuredBatchSize) ? Math.min(50, Math.max(1, configuredBatchSize)) : 1;
const MAX_RETRIES = 3;
const STALE_REMINDER_MS = 24 * 60 * 60 * 1000;
const CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
const INVOCATION_LOG_DOC = 'reminder_runs';

function truncate(value, limit) {
  return Array.from(String(value || '')).slice(0, limit).join('');
}

function formatShanghaiTime(value) {
  const date = new Date(value);
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = part => String(part).padStart(2, '0');
  return `${local.getUTCFullYear()}年${pad(local.getUTCMonth() + 1)}月${pad(local.getUTCDate())}日 ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

function errorText(error) {
  const code = error && (error.errCode || error.errcode || error.code);
  const message = error && (error.errMsg || error.errmsg || error.message);
  return truncate([code, message].filter(Boolean).join(': ') || 'subscribe_message_send_failed', 500);
}

// 探针：记录最近一次调用，用于确认定时触发器是否真的在触发。
// 这个函数超时只有 3 秒，所以只做一次覆盖写，不读取历史。
async function logInvocation(event, context, outcome) {
  try {
    await db.collection('admin_state').doc(INVOCATION_LOG_DOC).set({ data:{ last:{
      at:new Date().toISOString(),
      eventType:(event && event.Type) || null,
      triggerName:(event && event.TriggerName) || null,
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
    // 已调用微信但未写回状态也会留下 queued，自动重试可能重复通知。
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

async function sendReminder(item, now) {
  const user = await db.collection('user_account').doc(item.user_id).get();
  if (!user.data || !user.data.openid) throw new Error('user_openid_not_found');
  const taskName = truncate(item.task_name || `${item.competition_name || '大学生竞赛'}·${item.event_label || '报名'}提醒`, 20);
  await cloud.openapi.subscribeMessage.send({
    touser:user.data.openid,
    templateId:item.subscription_template_id || TEMPLATE_ID,
    page:`pages/detail/detail?id=${encodeURIComponent(item.edition_id)}`,
    miniprogramState:miniprogramStateOf(process.env.MINIPROGRAM_STATE),
    lang:'zh_CN',
    data:{
      thing1:{ value:taskName },
      time3:{ value:formatShanghaiTime(item.remind_at) },
      thing5:{ value:truncate(`请查看${item.event_label || '报名'}安排，以官方通知为准`, 20) },
    },
  });
  try {
    await db.collection('reminder').doc(item._id).update({
      data:{ delivery_status:'sent', sent_at:now.toISOString(), last_error:null, updated_at:now.toISOString() },
    });
  } catch (error) {
    // 通知已经发出，数据库写回失败必须区别于发送失败。
    error.reminderAlreadySent = true;
    throw error;
  }
}

// 经腾讯云 HTTP 访问服务（/send-reminders）调用时，参数在 event.body（JSON 字符串）里。
// 2026-10-01 起提醒数据在上海，由服务器每 5 分钟经 HTTP 派发（云开发定时触发器在这个环境不执行）。
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
  const due = await db.collection('reminder').where({
    authorization_status:'accepted',
    delivery_status:command.in(['pending','failed']),
    schedule_change_status:command.in(['normal','time_updated','postponed']),
    remind_at:command.lte(now.toISOString()),
  }).orderBy('remind_at', 'asc').limit(BATCH_SIZE).get();
  const summary = { scanned:due.data.length, sent:0, failed:0, manualRequired:0, expired:0, skipped:0 };
  for (const item of due.data) {
    if (!isDeliverableScheduleStatus(item.schedule_change_status)) { summary.skipped += 1; continue; }
    const retries = Number(item.retry_count || 0);
    if (retries >= MAX_RETRIES) {
      await db.collection('reminder').doc(item._id).update({ data:{ delivery_status:'manual_required', updated_at:now.toISOString() } });
      summary.manualRequired += 1;
      continue;
    }
    if (now.getTime() - new Date(item.remind_at).getTime() > STALE_REMINDER_MS) {
      await db.collection('reminder').doc(item._id).update({ data:{ delivery_status:'expired', updated_at:now.toISOString() } });
      summary.expired += 1;
      continue;
    }
    if (!await claimReminder(item, now)) { summary.skipped += 1; continue; }
    try {
      await sendReminder(item, now);
      summary.sent += 1;
    } catch (error) {
      const retryCount = retries + 1;
      const deliveryStatus = error.reminderAlreadySent ? 'manual_required' : failureDeliveryStatus(retryCount, MAX_RETRIES);
      await db.collection('reminder').doc(item._id).update({
        data:{ delivery_status:deliveryStatus, retry_count:retryCount, last_error:error.reminderAlreadySent ? `sent_but_state_update_failed: ${errorText(error)}` : errorText(error), updated_at:now.toISOString() },
      });
      if (deliveryStatus === 'manual_required') summary.manualRequired += 1;
      else summary.failed += 1;
      console.error('send reminder failed', { reminderId:item.id, retryCount, error });
    }
  }
  console.log('send reminders completed', summary);
  return summary;
};
