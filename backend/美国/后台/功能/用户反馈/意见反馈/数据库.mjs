// 意见反馈 · 取数据和操作（美国服务器上跑）：列表读北京同步到美国的意见反馈（用户副本的 general_feedback）；
// 处理结果（状态、公开回复、内部备注）经 环境.回传 写回北京正本（沟通/审核结果回传），用户在小程序“我的反馈”里看得到；比赛库留一条后台记录（2026-11-02）。
// 规则照旧后台 GeneralFeedbackModule.tsx + adminData/generalFeedback.js：已解决必须写公开回复；别的管理员刚改过就不覆盖。
//   取({ 动作: '保存', 编号, status, public_reply, internal_note, 读到的更新时间 }, { db, 用户副本库, 回传 }) → { 条目们, 接好了, 结果 }
import { 用户副本, 用户反馈 } from '../../../../db/index.mjs';

const 来源 = '北京同步来的意见反馈（用户副本的 general_feedback）';
const 状态名 = { pending: '待处理', processing: '处理中', resolved: '已解决' };
const 中文 = {
  feedback_conflict: '这条反馈已被其他管理员修改，请关闭后刷新并重新处理。',
  resolved_feedback_requires_reply: '标记为已解决时，请填写具体的公开回复。',
  feedback_not_found: '北京找不到这条反馈（可能已随账号删除）。',
};

async function 保存({ 编号, status, public_reply, internal_note, 读到的更新时间 }, { db, 回传 }) {
  const 回复 = String(public_reply ?? '').trim();
  if (status === 'resolved' && !回复) throw new Error(中文.resolved_feedback_requires_reply);
  const 改动 = { status, public_reply: 回复, internal_note: String(internal_note ?? '').trim() };
  try {
    await 回传({ 种类: '意见反馈', 编号, 改动, 读到的更新时间 });
  } catch (错误) {
    throw new Error(中文[错误?.message] || String(错误?.message || 错误));
  }
  用户反馈.记处理(db, { 动作: '处理意见反馈', 表: 'general_feedback', 编号, 详情: { 状态: 状态名[status] || status, 公开回复: 回复 } });
  return '处理结果已保存，用户可在“我的反馈”查看状态和公开回复。';
}

export async function 取(参数 = {}, 环境 = {}) {
  if (!环境.用户副本库) return { 条目: [], 来源, 接好了: false };
  const 结果 = 参数.动作 === '保存' ? await 保存(参数, 环境) : null;
  return { 条目们: 用户副本.列出(环境.用户副本库, 'general_feedback'), 来源, 接好了: true, 结果 };
}
