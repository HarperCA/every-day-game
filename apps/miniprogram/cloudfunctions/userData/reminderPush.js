// 用户保存提醒后，把“快到期的提醒”推给美国服务器的 reminder-dispatcher，让它按时间点准时发送。
// 推送内容只有提醒文档编号和提醒时间，不带用户信息：美国服务器到点时还要凭调度密钥向上海领取（claim），
// 由上海重新校验提醒是否仍然有效，所以推送被伪造或推错也发不出消息。
// 推送失败不影响保存，美国服务器每小时向上海对账一次会补上。
const https = require('https');

const DEFAULT_PUSH_URL = 'https://107-175-111-18.sslip.io/reminder-push';
// 只推两小时内到期的：更远的由每小时对账排进计划，这样大多数保存不用跨境多等一次
const PUSH_HORIZON_MS = 2 * 60 * 60 * 1000;
const DELIVERABLE = ['normal', 'time_updated', 'postponed'];

function reminderPushItems(documents, now = Date.now()) {
  return (documents || []).filter(item => item && item._id
    && item.authorization_status === 'accepted'
    && ['pending', 'failed'].includes(item.delivery_status)
    && DELIVERABLE.includes(item.schedule_change_status)
    && Number.isFinite(new Date(item.remind_at).getTime())
    && new Date(item.remind_at).getTime() <= now + PUSH_HORIZON_MS)
    .map(item => ({ key:String(item._id), remindAt:new Date(item.remind_at).toISOString() }));
}

function postJson(target, body, timeoutMs) {
  return new Promise(resolve => {
    const url = new URL(target);
    const data = JSON.stringify(body);
    const request = https.request(url, { method:'POST', headers:{ 'content-type':'application/json', 'content-length':Buffer.byteLength(data) }, timeout:timeoutMs }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('timeout', () => request.destroy(new Error('reminder_push_timeout')));
    request.on('error', error => { console.error('reminder push failed', error && error.message); resolve(0); });
    request.end(data);
  });
}

async function pushReminders(documents, { url = process.env.REMINDER_PUSH_URL || DEFAULT_PUSH_URL, timeoutMs = 3000, post = postJson } = {}) {
  const items = reminderPushItems(documents);
  if (!items.length || url === 'off') return { pushed:0 };
  const status = await post(url, { items }, timeoutMs);
  return { pushed:status >= 200 && status < 300 ? items.length : 0 };
}

module.exports = { PUSH_HORIZON_MS, pushReminders, reminderPushItems };
