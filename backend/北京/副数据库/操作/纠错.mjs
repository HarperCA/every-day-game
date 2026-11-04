// 纠错：用户指出某一届的信息有错。选项 { now }。
//   提交(db, 用户id, { edition_id, competition_name, category, content, evidence_url }, 选项)   待 AI 审核 → 记录
//   列出(db, 用户id)                                                                         新的在前
//   处理(db, 纠错id, { status, 读到的更新时间 }, 选项)   后台（美国）审核的结果写回正本（沟通/审核结果回传）；采纳、驳回记处理时间
//     读到的更新时间和现在的不一样：别人刚改过，报 feedback_conflict 不覆盖
import { randomBytes } from 'node:crypto';

export function 提交(db, 用户id, { edition_id, competition_name, category, content, evidence_url = null }, { now = new Date() } = {}) {
  const at = now.toISOString();
  return db.insert('feedback', `feedback-${now.getTime()}-${randomBytes(6).toString('hex')}`, {
    user_id: 用户id, edition_id, competition_name, category, content, evidence_url: evidence_url || null, created_at: at, updated_at: at,
  }).data;
}

export const 列出 = (db, 用户id) => db.find('feedback', { user_id: 用户id }, { orderBy: '-created_at' });

const 状态们 = ['pending_ai_review', 'ai_queued', 'ai_passed', 'ai_flagged', 'human_reviewing', 'accepted', 'rejected'];
export function 处理(db, 纠错id, { status, 读到的更新时间 }, { now = new Date() } = {}) {
  if (!状态们.includes(status)) throw new Error('invalid_feedback_status');
  return db.transaction(tx => {
    const 原 = tx.get('feedback', 纠错id)?.data;
    if (!原) throw new Error('feedback_not_found');
    if (原.updated_at !== 读到的更新时间) throw new Error('feedback_conflict');
    const 处理完 = ['accepted', 'rejected'].includes(status);
    return tx.update('feedback', 纠错id, { status, resolved_at: 处理完 ? (原.resolved_at || now.toISOString()) : null }).data;
  });
}
