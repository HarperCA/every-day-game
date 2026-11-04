// 报名时间变了，调整已设的提醒（2026-11-02，用户定放在北京做）。规则照旧小程序：提醒页 pages/reminders/reminders.ts + services/reminders.ts 的 syncReminderTarget——
//   只动还在等发送的（pending）；那件事的时间以主数据库里这一届为准，没公布（空）的、这一届不在了的不动；
//   时间变了：target_at 换新的；预设提前量的 remind_at 跟着挪（新时间 − 提前量），自定义的是用户选的绝对时间，不挪；时间变动标 time_updated。
//   只有日期的时间按北京时间算：开始当天 00:00:00、截止当天 23:59:59（同小程序 services/publicRecord.ts 的 reminderTarget）。
// 旧的要用户打开提醒页才对一次；北京由服务器自己对：每次对账先全部对一遍，到点领取前再对这一条（见 index.mjs）。
// 旧的“赛事取消、延期”靠 schedule.change_status，线上 343 条全是 normal，新比赛库没有这个字段，不做。
//
//   跟上时间(用户库, 主库, now, { 提醒id }) → { 改了: [提醒编号] }
import { 公开 } from '../../主数据库/index.mjs';

function 那件事的时间(届, 事) {
  const 值 = 事 === 'registration_start' ? 届.registration_start : 届.registration_end;
  if (typeof 值 !== 'string' || !值) return null;
  const 写法 = /^\d{4}-\d{2}-\d{2}$/.test(值) ? `${值}T${事 === 'registration_start' ? '00:00:00' : '23:59:59'}+08:00` : 值;
  const t = new Date(写法);
  return Number.isNaN(t.getTime()) ? null : t;
}

export function 跟上时间(用户库, 主库, now = new Date(), { 提醒id } = {}) {
  const 待发 = 提醒id === undefined
    ? 用户库.find('reminder', { delivery_status: 'pending' })
    : [用户库.get('reminder', 提醒id)?.data].filter(r => r?.delivery_status === 'pending');
  const 届次们 = new Map();
  const 改了 = [];
  for (const r of 待发) {
    if (!届次们.has(r.edition_id)) 届次们.set(r.edition_id, 公开.届次(主库, r.edition_id));
    const 届 = 届次们.get(r.edition_id);
    const 新 = 届 && 那件事的时间(届, r.event_type);
    if (!新 || 新.getTime() === new Date(r.target_at).getTime()) continue;
    const remind_at = r.advance_key === 'custom' ? r.remind_at : new Date(新.getTime() - Number(r.offset_ms)).toISOString();
    用户库.update('reminder', r.id, { target_at: 新.toISOString(), remind_at, schedule_change_status: 'time_updated', updated_at: now.toISOString() });
    改了.push(r.id);
  }
  return { 改了 };
}
