// 总览 · 取数据（美国服务器上跑）：从比赛库取每一届的状态和级别（届次没填级别的用比赛的）。已删除的不算（在回收站里）。
// 比赛库还没建（旧数据还没搬进来）时，交回 2026-10-22 线上 343 条的快照，并标明是示例。
import { 届次, 审核进度 } from '../../../db/index.mjs';

// 10-22 快照：reports/student-competition-enrichment-2026-10-15/work/live-competitions-detail-20261022.json 的实际分布（当时的草稿 13 条按新状态算待人工审核）
const 快照 = {
  时间: '2026-10-22',
  按状态: { 已归档: 290, 已发布: 40, 待人工审核: 13 },
  按级别: { 国家级: 164, '省级/区域级': 94, '其他/未明确': 84, 国际级: 1 },
};

// POST /api/后台/总览 { 动作: '审核进度', 比赛编号? }，登录后可查全部或指定比赛。
export async function 取({ 动作, 比赛编号 } = {}, { db, now = () => new Date() }) {
  if (动作 === '审核进度') return 审核进度.读(db, { 比赛编号, now: now() });
  const 行们 = 届次.search(db, {}, { limit: 100000 });
  if (!行们.length) return { 示例: true, 快照 };
  return {
    示例: false,
    时间: new Date().toISOString().slice(0, 10),
    届次们: 行们.map(行 => ({ 状态: 行.edition.status, 级别: 行.level })),
  };
}
