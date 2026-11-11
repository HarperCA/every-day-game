// 意见反馈 · 整理（纯计算）：新的在前，按状态、类型筛，换成中文标签（照旧后台 GeneralFeedbackModule.tsx 的 statuses、types）。
// 账号编号只露最后 6 位，够分辨是不是同一个人，不显示整串。
//   整理(原始, { 状态, 类型 }) → { 条目们, 数量: { 全部, pending, processing, resolved }, 状态们, 类型们, 结果, 接好了 }
export const 状态们 = { pending: '待处理', processing: '处理中', resolved: '已解决' };
export const 类型们 = { bug: '功能异常', suggestion: '使用建议', data: '数据问题', other: '其他' };

export function 整理(原始, 条件 = {}) {
  if (!原始?.接好了) return { 接好了: false, 来源: 原始?.来源 };
  const 全部 = [...原始.条目们].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const 数量 = { 全部: 全部.length, ...Object.fromEntries(Object.keys(状态们).map(键 => [键, 全部.filter(x => x.status === 键).length])) };
  const 条目们 = 全部
    .filter(x => (!条件.状态 || x.status === 条件.状态) && (!条件.类型 || x.type === 条件.类型))
    .map(x => ({ ...x, 状态: 状态们[x.status] || x.status, 类型: 类型们[x.type] || x.type, 账号: `…${String(x.user_id || '').slice(-6)}` }));
  return { 条目们, 数量, 状态们, 类型们, 结果: 原始.结果, 接好了: true };
}
