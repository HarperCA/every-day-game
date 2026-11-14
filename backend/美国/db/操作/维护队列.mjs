// 维护队列：后台多选比赛排进这里，由新维护的队列模式（新维护/运行.mjs --队列，定时器每 2 分钟看一眼）处理。存在“后台状态”表（admin_state）的 ai_maintenance_queue 一行。
// 2026-11-06 建（当时给旧 AI 审查用）；2026-11-12 用户定旧 AI 审查删掉、改由新维护处理，可以选任意数量（不设上限）；
// 新维护同时跑几个，所以“正在”是一组；做完的记进“最近”（后台总览显示进度用）。
//
//   读(db) → { 排队: [比赛编号], 正在: [比赛编号], 最近: [{ 比赛编号, 成功, 摘要, 结果, 原因, 时间 }] }
//   加入(db, 编号们, { 操作人, at }) → { 加入: 新排进去几个 }   去重（排着的、正在维护的不重复加）；比赛要存在；不设上限；留一条后台记录“启动维护”
//   领下一个(db, { at }) → 比赛编号 或 null                     排队里第一个没删的挪进“正在”（记开始时间）；删了的比赛顺手去掉
//   完成(db, 编号, { at, 成功, 摘要, 结果, 原因 })              从“正在”和排队去掉，记进“最近”（新的在前，同一个比赛只留最后一次，最多 30 个）
//   放回(db, 编号, { at })                                      额度用完时：从“正在”放回排队最前，下次接着跑
//   收回(db, { at }) → 收回几个                                 上次异常退出留下的“正在”放回排队最前；拿到维护锁之后才调，所以“正在”里的一定是留下的
//   有活(db) → 排队或“正在”里有没有                             定时器空跑时不拿锁直接退出
//   读暂停(db) / 生效暂停(db, now) / 暂停(db, 原因, { now }) / 清暂停(db, { now })
//                                                               AI 额度用完、余额不足时停 2 小时（admin_state 的 ai_quota_pause；沿用旧 AI 审查的那一行）
//   读进度(db, { now }) → { 正在: [{ 比赛编号, 名称, 开始时间 }], 排队数, 排队: [{ 比赛编号, 名称 }]（最多列 50 个）, 最近: [{ …, 名称 }], 暂停到 }
//                                                               后台总览的“维护进度”读
// 旧格式（正在 是一个编号或 null）读的时候换成一组。
import { DbError } from '../../../共用/db/index.mjs';
import { 记日志 } from './后台写入.mjs';

export const DOC = 'ai_maintenance_queue';
const 表 = 'admin_state';
export const 暂停编号 = 'ai_quota_pause';
export const 暂停毫秒 = 2 * 3600 * 1000;
export const 最近保留 = 30;
const 进度列几个 = 50;

// ---- 额度暂停 ----
export const 读暂停 = db => db.get(表, 暂停编号)?.data.data ?? null;

export function 生效暂停(db, now = new Date()) {
  const 暂停 = 读暂停(db);
  const 到 = Date.parse(暂停?.pausedUntil || '');
  return Number.isFinite(到) && 到 > now.getTime() ? 暂停 : null;
}

function 写一行(db, 编号, data) {
  db.transaction(tx => {
    const 原 = tx.get(表, 编号);
    if (原) tx.update(表, 编号, { data }, 原.version);
    else tx.insert(表, 编号, { data });
  });
}

export function 暂停(db, 原因, { now = new Date() } = {}) {
  const 上次 = 读暂停(db);
  写一行(db, 暂停编号, { pausedUntil: new Date(now.getTime() + 暂停毫秒).toISOString(), since: 上次?.pausedUntil ? 上次.since : now.toISOString(), reason: String(原因 || '').slice(0, 200), updatedAt: now.toISOString() });
}

export function 清暂停(db, { now = new Date() } = {}) {
  if (读暂停(db)?.pausedUntil) 写一行(db, 暂停编号, { pausedUntil: null, clearedAt: now.toISOString() });
}

// ---- 队列 ----
// 存的样子：{ 排队: [编号], 正在: [{ 比赛编号, 开始时间 }], 最近: [...], updated_at }
function 内容(row) {
  const d = row?.data?.data || {};
  const 正在 = (Array.isArray(d.正在) ? d.正在 : d.正在 ? [d.正在] : [])
    .map(x => (typeof x === 'string' ? { 比赛编号: x, 开始时间: null } : x));
  const 正在编号 = new Set(正在.map(x => x.比赛编号));
  return { 排队: (d.排队 || []).filter(编号 => !正在编号.has(编号)), 正在, 最近: d.最近 || [] };
}

function 写(tx, 新, at) {
  const 原 = tx.get(表, DOC);
  const data = { ...新, updated_at: at };
  if (原) tx.update(表, DOC, { data }, 原.version);
  else tx.insert(表, DOC, { data });
}

const 改 = (db, at, fn) => db.transaction(tx => {
  const 现在 = 内容(tx.get(表, DOC));
  const { 新, 交回 } = fn(现在, tx);
  if (新) 写(tx, { ...现在, ...新 }, at);
  return 交回;
});

export function 读(db) {
  const { 排队, 正在, 最近 } = 内容(db.get(表, DOC));
  return { 排队, 正在: 正在.map(x => x.比赛编号), 最近 };
}

export const 有活 = db => { const q = 读(db); return q.排队.length > 0 || q.正在.length > 0; };

export function 加入(db, 编号们, { 操作人 = '管理员', at = new Date().toISOString() } = {}) {
  return 改(db, at, (现在, tx) => {
    for (const 编号 of 编号们) if (!tx.get('competition', 编号)) throw new DbError('找不到', `没有这个比赛：${编号}`, { table: 'competition', id: 编号 });
    const 已有 = new Set([...现在.排队, ...现在.正在.map(x => x.比赛编号)]);
    const 新的 = [...new Set(编号们)].filter(编号 => !已有.has(编号));
    记日志(tx, '启动维护', 'competition', DOC, { 操作人, 比赛们: 编号们, 新排进去: 新的.length }, at);
    return { 新: { 排队: [...现在.排队, ...新的] }, 交回: { 加入: 新的.length } };
  });
}

export function 领下一个(db, { at = new Date().toISOString() } = {}) {
  return 改(db, at, (现在, tx) => {
    if (!现在.排队.length) return { 交回: null };
    const 还在 = 现在.排队.filter(编号 => tx.get('competition', 编号));
    const [下一个 = null, ...其余] = 还在;
    const 正在 = 下一个 ? [...现在.正在, { 比赛编号: 下一个, 开始时间: at }] : 现在.正在;
    return { 新: { 排队: 其余, 正在 }, 交回: 下一个 };
  });
}

export function 完成(db, 编号, { at = new Date().toISOString(), 成功 = false, 摘要 = '', 结果 = '', 原因 = '' } = {}) {
  改(db, at, 现在 => {
    const 这次 = { 比赛编号: 编号, 成功: Boolean(成功), 摘要: String(摘要 || ''), 结果: String(结果 || ''), 原因: String(原因 || '').slice(0, 300), 时间: at };
    return { 新: {
      排队: 现在.排队.filter(x => x !== 编号),
      正在: 现在.正在.filter(x => x.比赛编号 !== 编号),
      最近: [这次, ...现在.最近.filter(x => x.比赛编号 !== 编号)].slice(0, 最近保留),
    } };
  });
}

export function 放回(db, 编号, { at = new Date().toISOString() } = {}) {
  改(db, at, 现在 => ({ 新: { 排队: [编号, ...现在.排队.filter(x => x !== 编号)], 正在: 现在.正在.filter(x => x.比赛编号 !== 编号) } }));
}

export function 收回(db, { at = new Date().toISOString() } = {}) {
  return 改(db, at, 现在 => {
    if (!现在.正在.length) return { 交回: 0 };
    const 留下的 = 现在.正在.map(x => x.比赛编号);
    return { 新: { 排队: [...留下的, ...现在.排队.filter(x => !留下的.includes(x))], 正在: [] }, 交回: 留下的.length };
  });
}

export function 读进度(db, { now = new Date() } = {}) {
  const { 排队, 正在, 最近 } = 内容(db.get(表, DOC));
  const 名称 = id => db.get('competition', id)?.data.name;
  const 还在的排队 = 排队.filter(名称);
  return {
    正在: 正在.filter(x => 名称(x.比赛编号)).map(x => ({ 比赛编号: x.比赛编号, 名称: 名称(x.比赛编号), 开始时间: x.开始时间 })),
    排队数: 还在的排队.length,
    排队: 还在的排队.slice(0, 进度列几个).map(比赛编号 => ({ 比赛编号, 名称: 名称(比赛编号) })),
    最近: 最近.map(x => ({ ...x, 名称: 名称(x.比赛编号) ?? x.比赛编号 })),
    暂停到: 生效暂停(db, now)?.pausedUntil ?? null,
  };
}
