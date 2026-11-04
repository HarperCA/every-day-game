// 搜索接口：计划里的每个搜索词经 AI 总管搜一次（ctx.ai.search，百度 → Kimi → DeepSeek 补位，百度每天自动 30 次），并发。
// 结果标上渠道（哪家接口）、搜索词、路线；一个词失败只记问题，别的照常。
//
//   调用搜索(计划, ctx) → { 结果们: [{ 标题, 网址, 摘要, 日期, 渠道, 搜索词, 路线 }], 问题们, 每个词: [{ 词, 路线, 候选数, 成功 }] }
//   每个词 给搜索词的记录表用：搜失败的词 成功 为 false，不记录
import { createPool } from '../../../../../共用/工具/concurrency.mjs';

export const CONCURRENCY = 3;

export async function 调用搜索(计划, ctx) {
  const 词们 = 计划.搜索词们 || [];
  if (!词们.length) return { 结果们: [], 问题们: [], 每个词: [] };
  const pool = createPool({ limit: CONCURRENCY, signal: ctx.signal });
  // 屏蔽名单（内置 + 后台确认的）：百度不返回这些网站及其子站的结果（2026-11-02 照旧代码补上）
  const blocked = ctx.屏蔽网站?.() || [];
  const 回来 = await pool.map(词们, 词 => ctx.ai.search({ purpose: 'search', query: 词.词, blocked, signal: ctx.signal }));
  const 结果们 = [];
  const 问题们 = [];
  const 每个词 = [];
  回来.forEach((r, i) => {
    const 词 = 词们[i];
    if (!r.ok) {
      问题们.push(`搜索“${词.词}”失败：${String(r.error?.message || r.error)}`);
      每个词.push({ 词: 词.词, 路线: 词.路线, 候选数: 0, 成功: false });
      return;
    }
    const refs = r.value.references || [];
    每个词.push({ 词: 词.词, 路线: 词.路线, 候选数: refs.length, 成功: true });
    for (const ref of refs) {
      结果们.push({ 标题: ref.title || '', 网址: ref.url || '', 摘要: ref.content || '', 日期: ref.date || '', 渠道: r.value.provider || '', 搜索词: 词.词, 路线: 词.路线 });
    }
  });
  return { 结果们, 问题们, 每个词 };
}
