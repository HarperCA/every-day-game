// AI 去重要交回的格式（和 prompt.md 的“返回格式”一致）：
//   { 结果: [{ 编号, 结论, 比赛编号, 重复于, 把握, 理由 }] }，这一批每条候选一条
// 检查结果() 交回用不了的地方（空数组表示合格）；有问题就报告给 AI 总管并截断流程。
export const 结论们 = ['库里已有', '新的', '拿不准'];

export function 检查结果(data, 个数, 有这个比赛) {
  if (!data || !Array.isArray(data.结果)) return ['返回里没有“结果”列表'];
  const 问题 = [];
  const 收到 = new Map();
  for (const r of data.结果) {
    const 编号 = Number(r?.编号);
    if (!Number.isInteger(编号) || 编号 < 1 || 编号 > 个数) { 问题.push(`编号「${r?.编号}」不在 1 到 ${个数} 之间`); continue; }
    if (收到.has(编号)) { 问题.push(`编号 ${编号} 出现了两次`); continue; }
    收到.set(编号, r);
    if (!结论们.includes(r.结论)) 问题.push(`编号 ${编号} 的结论「${r.结论}」不是 ${结论们.join('/')} 之一`);
    if (r.结论 === '库里已有' && !有这个比赛(r.比赛编号)) 问题.push(`编号 ${编号} 判为库里已有，但比赛编号「${r.比赛编号}」不在库里`);
    if (r.重复于 != null && !(Number.isInteger(r.重复于) && r.重复于 >= 1 && r.重复于 < 编号)) 问题.push(`编号 ${编号} 的重复于「${r.重复于}」要填前面某一条的编号`);
    if (typeof r.把握 !== 'number' || r.把握 < 0 || r.把握 > 1) 问题.push(`编号 ${编号} 的把握「${r.把握}」不是 0 到 1 的小数`);
  }
  const 漏了 = Array.from({ length: 个数 }, (_, i) => i + 1).filter(n => !收到.has(n));
  if (漏了.length) 问题.push(`漏了 ${漏了.length} 条候选的结论（编号 ${漏了.join('、')}）`);
  return 问题;
}
