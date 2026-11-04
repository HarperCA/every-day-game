// 纠错审核 · 整理（纯计算）：新的在前，按视图筛（全部、待处理、已处理），换成中文标签（照旧后台 OperationModules.tsx 的 feedbackStatusLabels、feedbackCategoryLabels）。
// 已采纳、已驳回的不再显示处理按钮。
//   整理(原始, { 视图 }) → { 条目们, 数量: { 全部, 待处理, 已处理 }, 视图们, 结果, 接好了 }
const 状态名 = { pending_ai_review: '待AI审核', ai_queued: 'AI审核排队中', ai_passed: 'AI已通过·待抽查', ai_flagged: 'AI标记问题', human_reviewing: '人工审核中', accepted: '已采纳', rejected: '已驳回' };
const 类别名 = { time: '时间错误', registration_link: '报名链接', eligibility: '参赛资格', rules: '规则信息', other: '其他' };
const 处理完 = 状态 => ['accepted', 'rejected'].includes(状态);
export const 视图们 = ['全部', '待处理', '已处理'];

export function 整理(原始, 条件 = {}) {
  if (!原始?.接好了) return { 接好了: false, 来源: 原始?.来源 };
  const 全部 = [...原始.条目们].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const 数量 = { 全部: 全部.length, 待处理: 全部.filter(x => !处理完(x.status)).length, 已处理: 全部.filter(x => 处理完(x.status)).length };
  const 视图 = 视图们.includes(条件.视图) ? 条件.视图 : '全部';
  const 条目们 = 全部
    .filter(x => 视图 === '全部' || (视图 === '待处理') === !处理完(x.status))
    .map(x => ({ ...x, 状态: 状态名[x.status] || x.status, 类别: 类别名[x.category] || x.category, 能处理: !处理完(x.status), 账号: `…${String(x.user_id || '').slice(-6)}` }));
  return { 条目们, 数量, 视图, 视图们, 结果: 原始.结果, 接好了: true };
}
