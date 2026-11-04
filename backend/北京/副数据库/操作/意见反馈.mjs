// 意见反馈：用户对小程序本身的意见。选项 { now }。
//   提交(db, 用户id, { type, content, contact, app_version }, 选项)   待处理 → 记录
//   列出(db, 用户id)                                                新的在前
//   处理(db, 意见id, { status, public_reply, internal_note, 读到的更新时间 }, 选项)   后台（美国）处理的结果写回正本（沟通/审核结果回传）
//     规则照旧上海 adminData/generalFeedback.js 的 update：已解决必须写公开回复；已解决记处理时间，改回去清掉；读到的更新时间对不上报 feedback_conflict
import { randomBytes } from 'node:crypto';

export function 提交(db, 用户id, { type = 'other', content, contact = null, app_version = null }, { now = new Date() } = {}) {
  const at = now.toISOString();
  return db.insert('general_feedback', `general-feedback-${randomBytes(12).toString('hex')}`, {
    user_id: 用户id, type, content, contact: contact || null, app_version: app_version || null, created_at: at, updated_at: at,
  }).data;
}

export const 列出 = (db, 用户id) => db.find('general_feedback', { user_id: 用户id }, { orderBy: '-created_at' });

const 状态们 = ['pending', 'processing', 'resolved'];
const 文字 = (值, 字段, 最长) => {
  if (值 == null) return '';
  if (typeof 值 !== 'string' || 值.trim().length > 最长) throw new Error(`invalid_${字段}`);
  return 值.trim();
};
export function 处理(db, 意见id, { status, public_reply, internal_note, 读到的更新时间 }, { now = new Date() } = {}) {
  if (!状态们.includes(status)) throw new Error('invalid_feedback_status');
  const 回复 = 文字(public_reply, 'public_reply', 2000);
  if (status === 'resolved' && !回复) throw new Error('resolved_feedback_requires_reply');
  const 备注 = 文字(internal_note, 'internal_note', 2000);
  return db.transaction(tx => {
    const 原 = tx.get('general_feedback', 意见id)?.data;
    if (!原) throw new Error('feedback_not_found');
    if (原.updated_at !== 读到的更新时间) throw new Error('feedback_conflict');
    return tx.update('general_feedback', 意见id, {
      status, public_reply: 回复 || null, internal_note: 备注 || null,
      resolved_at: status === 'resolved' ? (原.resolved_at || now.toISOString()) : null,
    }).data;
  });
}
