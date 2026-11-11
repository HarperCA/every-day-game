// 操作记录 · 取数据（美国服务器上跑）：读比赛库的后台记录表 audit_log，新到旧，每页 50 条。只看不改（2026-11-01 用户定）。
// 谁写这张表：比赛、届次的新建、编辑、改状态、删除、恢复（比赛库的 比赛.*、届次.*），回收站清理，维护（每个比赛一条，改正的每处一条）。
// 维护每 5 分钟一条，所以按类型筛选、翻页都在这里做，不把整张表交给浏览器。
//
//   取({ 页, 类型, 搜 }, { db })   类型见 类型们；搜：在编号和内容（名称等）里找这段文字
import { TABLES } from '../../../../db/index.mjs';

export const 每页 = 50;
export const 类型们 = [
  { 名称: '全部', 动作们: null },
  { 名称: '后台编辑', 动作们: ['新建比赛', '编辑比赛', '新建届次', '编辑届次', '改状态'] },
  { 名称: '删除和恢复', 动作们: ['标记删除比赛', '标记删除届次', '恢复比赛', '恢复届次', '回收站清理'] },
  { 名称: '自动维护', 动作们: ['维护比赛', '维护改正'] },
];

// 字段的中文名：取比赛库描述里说明的第一段（“报名截止（原文只写日期的…）”→“报名截止”）
const 字段名 = Object.fromEntries(['competition', 'edition'].map(表 => [表,
  Object.fromEntries(Object.entries(TABLES[表].字段).map(([名, 字段]) => [名, 字段.说明.split(/[（：；(]/)[0]]))]));

export async function 取({ 页 = 1, 类型 = '全部', 搜 = '' } = {}, { db }) {
  const 类 = 类型们.find(t => t.名称 === 类型);
  if (!类) throw new Error(`不认识的类型：${类型}`);
  const 条件 = {};
  if (类.动作们) 条件.action = { in: 类.动作们 };
  const 词 = String(搜 || '').trim();
  if (词) 条件.or = [{ record_id: { like: 词 } }, { detail: { like: 词 } }];
  const 第几页 = Math.max(1, Math.floor(Number(页)) || 1);
  const 条目 = db.find('audit_log', 条件, { orderBy: ['-created_at', '-id'], limit: 每页, offset: (第几页 - 1) * 每页 });
  // 记录里没写名称的（维护只记编号），按编号到比赛库查，删了的也查；查不到（已彻底删除）就只显示编号
  for (const e of 条目) {
    if (e.detail?.名称 || !['competition', 'edition'].includes(e.table_name) || !e.record_id) continue;
    const 行 = db.get(e.table_name, e.record_id, { 包括已删除: true })?.data;
    const 名称 = e.table_name === 'competition' ? 行?.name : 行?.edition_name;
    if (名称) e.detail = { ...e.detail, 名称 };
  }
  return {
    条目,
    总数: db.count('audit_log', 条件),
    页: 第几页, 每页, 类型, 搜: 词,
    类型们: 类型们.map(t => t.名称),
    字段名,
  };
}
