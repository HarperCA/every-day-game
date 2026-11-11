// 维护队列（2026-11-06 用户定）：后台多选比赛启动 AI 维护，排进这里，由定时器每 2 分钟看一眼，跑的时候最优先。存在“后台状态”表（admin_state）的 ai_maintenance_queue 一行。
//
//   读(db) → { 排队: [比赛编号], 正在: 比赛编号 或 null }
//   加入(db, 编号们, { 操作人, at }) → { 加入: 新排进去几个 }   去重；比赛要存在；一次最多 50 个；留一条后台记录
//   领下一个(db, { at, 跳过 }) → 比赛编号 或 null              排队里第一个没删的，标成正在；删了的比赛顺手去掉
//   完成(db, 编号, { at })                                    从排队去掉，正在清空
//   放回(db, 编号, { at })                                    额度用完时：留在排队里，正在清空，下次接着跑
// 同一时间只有一个进程在跑维护（运行锁保证），所以上次异常退出留下的“正在”不用管，领的时候覆盖掉。
import { DbError } from '../../../共用/db/index.mjs';
import { 记日志 } from './后台写入.mjs';

export const DOC = 'ai_maintenance_queue';
export const 一次最多 = 50;
const 表 = 'admin_state';
export const 暂停编号 = 'ai_quota_pause';

export const 读暂停 = db => db.get(表, 暂停编号)?.data.data ?? null;

export function 生效暂停(db, now = new Date()) {
  const 暂停 = 读暂停(db);
  const 到 = Date.parse(暂停?.pausedUntil || '');
  return Number.isFinite(到) && 到 > now.getTime() ? 暂停 : null;
}

const 内容 = row => ({ 排队: row?.data?.data?.排队 || [], 正在: row?.data?.data?.正在 || null });

function 写(tx, 新, at) {
  const 原 = tx.get(表, DOC);
  const data = { ...新, updated_at: at };
  if (原) tx.update(表, DOC, { data }, 原.version);
  else tx.insert(表, DOC, { data });
}

export const 读 = db => 内容(db.get(表, DOC));

export function 加入(db, 编号们, { 操作人 = '管理员', at = new Date().toISOString() } = {}) {
  if (编号们.length > 一次最多) throw new DbError('请求有误', `一次最多选 ${一次最多} 个比赛`, { table: 'competition' });
  return db.transaction(tx => {
    for (const 编号 of 编号们) if (!tx.get('competition', 编号)) throw new DbError('找不到', `没有这个比赛：${编号}`, { table: 'competition', id: 编号 });
    const 现在 = 内容(tx.get(表, DOC));
    const 新的 = [...new Set(编号们)].filter(编号 => !现在.排队.includes(编号));
    写(tx, { ...现在, 排队: [...现在.排队, ...新的] }, at);
    记日志(tx, '启动AI维护', 'competition', 'ai_maintenance_queue', { 操作人, 比赛们: 编号们, 新排进去: 新的.length }, at);
    return { 加入: 新的.length };
  });
}

export function 领下一个(db, { at = new Date().toISOString(), 跳过 = [] } = {}) {
  return db.transaction(tx => {
    const 现在 = 内容(tx.get(表, DOC));
    if (!现在.排队.length && !现在.正在) return null;
    const 还在 = 现在.排队.filter(编号 => tx.get('competition', 编号));
    const 下一个 = 还在.find(编号 => !跳过.includes(编号)) ?? null;
    写(tx, { 排队: 还在, 正在: 下一个 }, at);
    return 下一个;
  });
}

export function 完成(db, 编号, { at = new Date().toISOString() } = {}) {
  db.transaction(tx => {
    const 现在 = 内容(tx.get(表, DOC));
    写(tx, { 排队: 现在.排队.filter(x => x !== 编号), 正在: null }, at);
  });
}

export function 放回(db, 编号, { at = new Date().toISOString() } = {}) {
  db.transaction(tx => {
    const 现在 = 内容(tx.get(表, DOC));
    写(tx, { 排队: 现在.排队.includes(编号) ? 现在.排队 : [编号, ...现在.排队], 正在: null }, at);
  });
}
