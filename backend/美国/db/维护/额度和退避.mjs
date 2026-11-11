// AI 审查的额度暂停和失败退避（2026-11-07 用户定，逻辑照旧系统 aiQuotaPause.js、aiReviewSchedule.js）。存在“后台状态”表（admin_state）。
//
//   额度暂停  额度用完停 2 小时（用户定；旧系统是 5 小时，但批次本来就每 5 小时一次，停 5 小时会跳过下一批），期间不调 AI，手动队列也等着；到点后还是用完再停 2 小时；有调用成功就清掉。
//   失败退避  同一个比赛每失败一次多等 6 小时，最多 7 天，成功清零，免得一个跑不通的比赛每批都白花额度。额度用完不算失败。后台手动排的不看退避。
//
//   读暂停(db) / 生效暂停(db, now) / 写暂停(db, 原因, now) / 清暂停(db, now)
//   退避到(记录) → 毫秒时间 / 退避中的比赛(db, now) → [比赛编号] / 记失败(db, 比赛, 错误, now) / 清失败(db, 比赛, now)
const 表 = 'admin_state';
import { 维护队列 } from '../index.mjs';
const { 暂停编号: 暂停DOC } = 维护队列;
const 失败DOC = 'ai_maintenance_failures';
export const 暂停毫秒 = 2 * 3600 * 1000;
export const 退避步长毫秒 = 6 * 3600 * 1000;
export const 退避上限毫秒 = 7 * 24 * 3600 * 1000;

const 读 = (db, DOC) => db.get(表, DOC)?.data?.data ?? null;
function 写(db, DOC, data) {
  db.transaction(tx => {
    const 原 = tx.get(表, DOC);
    if (原) tx.update(表, DOC, { data }, 原.version);
    else tx.insert(表, DOC, { data });
  });
}

export const { 读暂停, 生效暂停 } = 维护队列;

export function 写暂停(db, 原因, now = new Date()) {
  const 上次 = 读暂停(db);
  写(db, 暂停DOC, { pausedUntil: new Date(now.getTime() + 暂停毫秒).toISOString(), since: 上次?.pausedUntil ? 上次.since : now.toISOString(), reason: String(原因 || '').slice(0, 200), updatedAt: now.toISOString() });
}

export function 清暂停(db, now = new Date()) {
  if (读暂停(db)?.pausedUntil) 写(db, 暂停DOC, { pausedUntil: null, clearedAt: now.toISOString() });
}

export function 退避到(记录) {
  const 次 = Number(记录?.count) || 0;
  const 上次 = Date.parse(记录?.lastAt || '');
  if (次 <= 0 || !Number.isFinite(上次)) return 0;
  return 上次 + Math.min(次 * 退避步长毫秒, 退避上限毫秒);
}

export function 退避中的比赛(db, now = new Date()) {
  return Object.entries(读(db, 失败DOC) || {}).filter(([, 记录]) => 退避到(记录) > now.getTime()).map(([比赛]) => 比赛);
}

export function 记失败(db, 比赛, 错误, now = new Date()) {
  const 全部 = 读(db, 失败DOC) || {};
  写(db, 失败DOC, { ...全部, [比赛]: { count: (Number(全部[比赛]?.count) || 0) + 1, lastAt: now.toISOString(), error: String(错误 || '').slice(0, 300) } });
}

export function 清失败(db, 比赛) {
  const 全部 = 读(db, 失败DOC);
  if (!全部?.[比赛]) return;
  const { [比赛]: _去掉, ...其余 } = 全部;
  写(db, 失败DOC, 其余);
}
