// 最终结果：只调小数据库的接口（ctx.小数据库），不直接碰 run.db。
//   1 创建当晚：记下当晚的计划和数量（搜索词、平台、候选）
//   2 写入结果：每条候选写成 kind 为 candidate、状态“进行中”的条目，交给 02 对比去重；问题一起写进去，进当晚报告
//
//   写入最终结果({ 计划, 候选们, 问题们 }, ctx) → 小数据库交回的统计
export async function 写入最终结果({ 计划, 候选们, 问题们 = [] }, ctx) {
  ctx.小数据库.创建当晚({ 计划, 搜索词: 计划.搜索词们.length, 平台: 计划.平台们.length, 候选: 候选们.length });
  return ctx.小数据库.写入结果({
    items: 候选们.map(c => ({ key: c.key, kind: 'candidate', status: '进行中', data: c.data, result: '搜到', reason: '' })),
    changes: [],
    problems: 问题们,
  });
}
