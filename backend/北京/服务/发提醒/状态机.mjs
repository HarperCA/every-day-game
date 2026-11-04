// 发提醒的状态机：搬自上海云函数 sendReminders 的 listUpcoming、claim、report、recoverTimedOutClaims（2026-11-02），规则原样，
// 存取从云开发集合改成用户库（副数据库）的 reminder、user_account 表；提醒编号就是上海的文档编号 _id。
// 规则：
//   列出快到期的：授权了、待发或上次失败、时间没取消的，到 窗口（默认 2 小时，最长 6 小时）内的；过期超过 24 小时的标 stale，交给领取去清理
//   领取：到点时重新校验，仍然有效就标成 queued（领取时提醒没被改过才算数），交回发送内容（含 openid）；时间改到以后了就要求重排；
//         重试到 3 次转人工；过期超过 24 小时标 expired；找不到 openid 记失败、计重试
//   回写：只回写本轮领取过（queued）的；成功标 sent；结果不明转人工，不自动重发；普通失败计重试
//   回收超时：领取后 15 分钟没回写的转人工（不知道微信发没发，自动重试可能重复通知）
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildSubscribePayload, failureDeliveryStatus, isDeliverableScheduleStatus, requireReminderKey, upcomingWindowMs } = require('./reminderDelivery.js');

export const TEMPLATE_ID = 'Hdc1YLawcLjHfgiAjZYF6fJMkAMTwcPCHZYqLyvo2mY';
const MAX_RETRIES = 3;
const STALE_REMINDER_MS = 24 * 60 * 60 * 1000;
const CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_UPCOMING = 200;
const DELIVERABLE_SCHEDULES = ['normal', 'time_updated', 'postponed'];

function truncate(value, limit) {
  return Array.from(String(value || '')).slice(0, limit).join('');
}

const 读提醒 = (用户库, key) => 用户库.get('reminder', key)?.data ?? null;
const 改 = (用户库, key, data) => 用户库.update('reminder', key, data);

export function 回收超时(用户库, now) {
  const expiredClaimAt = new Date(now.getTime() - CLAIM_TIMEOUT_MS).toISOString();
  for (const item of 用户库.find('reminder', { delivery_status: 'queued', updated_at: { lte: expiredClaimAt } })) {
    // 已交给发送方但没回写结果也会留下 queued，自动重试可能重复通知。
    改(用户库, item.id, { delivery_status: 'manual_required', last_error: 'send_claim_timeout_delivery_unknown', updated_at: now.toISOString() });
  }
}

// 领取时提醒没被改过才算数（上海是带着读到的各字段做条件更新）
function 领取(用户库, item, now) {
  return 用户库.transaction(tx => {
    const current = tx.get('reminder', item.id)?.data;
    const 没变 = current && current.delivery_status === item.delivery_status && current.authorization_status === 'accepted'
      && current.remind_at === item.remind_at && current.schedule_change_status === item.schedule_change_status && current.updated_at === item.updated_at;
    if (!没变) return false;
    tx.update('reminder', item.id, { delivery_status: 'queued', updated_at: now.toISOString() });
    return true;
  });
}

export function listUpcoming(用户库, now, event = {}) {
  const until = new Date(now.getTime() + upcomingWindowMs(event.withinMs)).toISOString();
  const since = new Date(now.getTime() - STALE_REMINDER_MS).toISOString();
  const rows = 用户库.find('reminder', {
    authorization_status: 'accepted',
    delivery_status: { in: ['pending', 'failed'] },
    schedule_change_status: { in: DELIVERABLE_SCHEDULES },
    remind_at: { lte: until },
  }, { orderBy: 'remind_at', limit: MAX_UPCOMING });
  // 过期超过 24 小时的交给 claim 标成 expired，这里也一并列出，让发送方去领取一次以便清理
  return { items: rows.map(item => ({ key: item.id, remindAt: item.remind_at, stale: item.remind_at < since })) };
}

export function claim(用户库, now, event = {}) {
  const item = 读提醒(用户库, requireReminderKey(event.key));
  if (!item) return { status: 'missing' };
  if (item.authorization_status !== 'accepted' || !['pending', 'failed'].includes(item.delivery_status)
    || !isDeliverableScheduleStatus(item.schedule_change_status)) {
    return { status: 'skip', reason: `state_${item.authorization_status}_${item.delivery_status}_${item.schedule_change_status}` };
  }
  const remindAt = new Date(item.remind_at).getTime();
  // 提醒时间改到以后了：告诉发送方按新时间重排（允许 5 秒时钟误差）
  if (remindAt > now.getTime() + 5000) return { status: 'reschedule', remindAt: item.remind_at };
  const retries = Number(item.retry_count || 0);
  if (retries >= MAX_RETRIES) {
    改(用户库, item.id, { delivery_status: 'manual_required', updated_at: now.toISOString() });
    return { status: 'skip', reason: 'retries_exhausted' };
  }
  if (now.getTime() - remindAt > STALE_REMINDER_MS) {
    改(用户库, item.id, { delivery_status: 'expired', updated_at: now.toISOString() });
    return { status: 'skip', reason: 'expired' };
  }
  const openid = 用户库.get('user_account', item.user_id)?.data?.openid;
  if (!openid) {
    const retryCount = retries + 1;
    改(用户库, item.id, { delivery_status: failureDeliveryStatus(retryCount, MAX_RETRIES), retry_count: retryCount, last_error: 'user_openid_not_found', updated_at: now.toISOString() });
    return { status: 'skip', reason: 'user_openid_not_found' };
  }
  if (!领取(用户库, item, now)) return { status: 'skip', reason: 'claim_conflict' };
  return {
    status: 'ready',
    payload: buildSubscribePayload(item, openid, { templateId: TEMPLATE_ID, miniprogramState: process.env.MINIPROGRAM_STATE }),
  };
}

export function report(用户库, now, event = {}) {
  const item = 读提醒(用户库, requireReminderKey(event.key));
  if (!item) return { status: 'missing' };
  // 只回写本轮领取过的提醒，防止旧结果覆盖用户新改的提醒
  if (item.delivery_status !== 'queued') return { status: 'ignored', reason: `state_${item.delivery_status}` };
  if (event.ok === true) {
    改(用户库, item.id, { delivery_status: 'sent', sent_at: now.toISOString(), last_error: null, updated_at: now.toISOString() });
    return { status: 'sent' };
  }
  const retryCount = Number(item.retry_count || 0) + 1;
  const deliveryStatus = event.uncertain === true ? 'manual_required' : failureDeliveryStatus(retryCount, MAX_RETRIES);
  改(用户库, item.id, { delivery_status: deliveryStatus, retry_count: retryCount, last_error: truncate(event.error || 'subscribe_message_send_failed', 500), updated_at: now.toISOString() });
  return { status: deliveryStatus };
}
