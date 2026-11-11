// 平台：针对性平台搜索脚本的集成接口。计划里列的平台同时跑，一个平台失败只记问题，别的平台的结果照收。
//
//   调用平台(计划, ctx, 平台们 = PLATFORMS) → { 结果们: [{ 标题, 网址, 摘要, 渠道: 平台名, 搜索词: '', 路线: '平台' }], 问题们 }
//   每个平台脚本：(ctx) → [{ 标题, 网址, 摘要 }]
import { PLATFORMS } from './平台清单.mjs';

export async function 调用平台(计划, ctx, 平台们 = PLATFORMS) {
  const 结果们 = [];
  const 问题们 = [];
  const 要跑 = [];
  for (const 名 of 计划.平台们 || []) {
    if (!Object.hasOwn(平台们, 名)) 问题们.push(`没有这个平台：${名}`);
    else 要跑.push(名);
  }
  const 回来 = await Promise.allSettled(要跑.map(名 => 平台们[名](ctx)));
  回来.forEach((r, i) => {
    const 名 = 要跑[i];
    if (r.status === 'rejected') { 问题们.push(`平台“${名}”失败：${String(r.reason?.message || r.reason)}`); return; }
    for (const x of r.value || []) 结果们.push({ 标题: x.标题 || '', 网址: x.网址 || '', 摘要: x.摘要 || '', 渠道: 名, 搜索词: '', 路线: '平台' });
  });
  return { 结果们, 问题们 };
}
