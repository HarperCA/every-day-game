// 查找：缺失的信息、知道错了但不知道正确值的，调工具去查。说明见同目录 README.md。
//
//   findMissing(problem, ctx) → { 找到: boolean, 改动: { 字段: 值 }, 出处: [{ 网址, 原文 }], 把握: '有把握' | '不确定', 说明 }
//
// 现在会处理的：缺失字段检查交来的问题（带 字段们）——交给 Codex 补字段（美国/补字段/，2026-11-03 用户定），它去官方网页上找，
// 程序核对每个值都在读过的原文里，找得到出处的才算补到。
//   补到的：交回改动和出处（有把握），分流后直接改，后台记录留出处
//   官方写“待公布”的时间：届次标 pending_announcement
//   都没补到：找到 false，留着，下次轮到再查
//   已发布、报名还没截止、却补不到报名时间：找到 true、不确定、没有改动 → 分流转人工审核（学生正要报名，缺时间不能等）
//     补到了别的、报名时间还是没有的：补到的照写，另带 转人工（原因），维护同时转人工（2026-11-03 用户定）
// 别的问题（链接打不开等）还不会查：找到 false，写明原因。
// 来源：旧系统 trace-drafts.mjs（记录追溯）、organizer-watch.mjs（主办方监测）的思路由 Codex 代理做（搜索、读主办方网页）。
import { 补字段 } from '../../../../补字段/index.mjs';

const 时间们 = ['registration_start', 'registration_end', 'competition_start', 'competition_end'];
const 报名时间 = ['registration_start', 'registration_end'];

// 只写日期的截止按北京时间当天结束算（和每日归档、报名状态一样）
export function 报名还没截止(届, now) {
  if (!届.registration_end) return true;
  const 值 = /^\d{4}-\d{2}-\d{2}$/.test(届.registration_end) ? `${届.registration_end}T23:59:59.999+08:00` : 届.registration_end;
  const t = Date.parse(值);
  return !Number.isFinite(t) || t >= now.getTime();
}

// 交给 Codex 的已知信息：届次带上比赛名称、官网、已有来源；比赛带上最新一届的来源
function 已知(problem, ctx) {
  const 行 = ctx.db.get(problem.table, problem.key).data;
  if (problem.table === 'edition') {
    const 比赛 = ctx.db.get('competition', 行.competition_id)?.data || {};
    return { 行, 记录: { ...行, name: 比赛.name, website: 比赛.website, organizer: 行.organizer || 比赛.organizer, sources: ctx.db.find('source', { edition_id: problem.key }) } };
  }
  const 最新 = ctx.db.find('edition', { competition_id: problem.key }, { orderBy: '-ordinal', limit: 1 })[0];
  return { 行, 记录: { ...行, edition_name: 最新?.edition_name, sources: 最新 ? ctx.db.find('source', { edition_id: 最新.id }) : [] } };
}

export async function findMissing(problem, ctx) {
  if (!Array.isArray(problem.字段们)) return { 找到: false, 说明: '这类问题查找还不会处理（现在只补缺失字段）' };
  const { 行, 记录 } = 已知(problem, ctx);
  const r = await 补字段(记录, problem.字段们, ctx);
  const 改动 = { ...r.补到 };
  if (problem.table === 'edition' && r.待公布.some(k => 时间们.includes(k)) && !行.pending_announcement) 改动.pending_announcement = true;
  const 说明 = [Object.keys(r.补到).length ? `补到：${Object.keys(r.补到).join('、')}` : '', r.待公布.length ? `官方写待公布：${r.待公布.join('、')}` : '',
    r.没补到.length ? `没补到：${r.没补到.join('、')}` : '', r.原因].filter(Boolean).join('；');
  const 要人看 = problem.table === 'edition' && 行.status === '已发布' && 报名时间.some(k => r.没补到.includes(k)) && 报名还没截止(行, ctx.now());
  const 人看原因 = `已发布、报名还没截止，却补不到报名时间，要人看；${说明}`;
  if (Object.keys(改动).length) return { 找到: true, 改动, 出处: r.来源们, 把握: '有把握', 说明, ...(要人看 ? { 转人工: 人看原因 } : {}) };
  if (要人看) return { 找到: true, 改动: {}, 出处: [], 把握: '不确定', 说明: 人看原因 };
  return { 找到: false, 说明: 说明 || '没补到' };
}
