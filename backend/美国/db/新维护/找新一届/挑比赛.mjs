// 找新一届 · 挑这次找哪些比赛（2026-11-12 用户定）：只读比赛库，不改东西。
//   最新一届（ordinal 最大、没删的）已归档；预计报名时间（调度/ 的 检查频率：历届间隔推算 → 每日归档存的下一届预计 → 报名或比赛开始加一年；
//   最新一届一个日期都没有时用上一届推）已经过了、或在 60 天以内；一个预计都推不出来的也找，排在最后。
//   上次找新一届（后台记录 audit_log 里 action“找新一届”最新的那条）在 7 天以内的这次不找——每周只搜上次以来的新结果。
//   预计时间离今天越近越先（过了的、快到的都按相差几天算）；同样的按比赛编号。
//
//   上次找新一届(db, 比赛编号?) → Map<比赛编号, 时间>（给了编号只查这一个）
//   挑要找的(db, { now, 上限 }) → [{ 比赛, 名称, 预计报名, 距今天数, 上次找 }]
import { 检查频率 } from '../调度/index.mjs';

export const 后台动作 = '找新一届';
export const 窗口天数 = 60;
export const 间隔天数 = 7;
const 天 = 24 * 60 * 60 * 1000;

export function 上次找新一届(db, 比赛编号 = null) {
  const 条件 = 比赛编号 ? { action: 后台动作, record_id: 比赛编号 } : { action: 后台动作 };
  const 回 = new Map();
  for (const 行 of db.find('audit_log', 条件)) {
    if (!行.record_id || !行.created_at) continue;
    if (!回.has(行.record_id) || 行.created_at > 回.get(行.record_id)) 回.set(行.record_id, 行.created_at);
  }
  return 回;
}

export function 挑要找的(db, { now = new Date(), 上限 = Infinity } = {}) {
  const t = now.getTime();
  const 按比赛 = new Map();
  for (const 届 of db.find('edition', {}, { orderBy: 'id' })) {
    if (!按比赛.has(届.competition_id)) 按比赛.set(届.competition_id, []);
    按比赛.get(届.competition_id).push(届);
  }
  const 上次 = 上次找新一届(db);
  const 回 = [];
  for (const 比赛 of db.find('competition', {}, { orderBy: 'id' })) {
    const 届们 = 按比赛.get(比赛.id) || [];
    const 最新 = [...届们].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0)).at(-1);
    if (!最新 || 最新.status !== '已归档') continue;
    const 上次找 = 上次.get(比赛.id) || null;
    if (上次找 && t - Date.parse(上次找) < 间隔天数 * 天) continue;
    const 预计报名 = 检查频率(届们, now).预计报名;
    const 距今天数 = 预计报名 == null ? null : Math.round((Date.parse(预计报名) - t) / 天);
    if (距今天数 != null && 距今天数 > 窗口天数) continue;
    回.push({ 比赛: 比赛.id, 名称: 比赛.name, 预计报名, 距今天数, 上次找 });
  }
  return 回
    .sort((a, b) => (a.距今天数 == null) - (b.距今天数 == null) || Math.abs(a.距今天数 ?? 0) - Math.abs(b.距今天数 ?? 0) || (a.比赛 < b.比赛 ? -1 : 1))
    .slice(0, 上限);
}
