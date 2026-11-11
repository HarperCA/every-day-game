// 回收站 · 取数据和操作（美国服务器上跑）：列出删了的比赛和单独删的届次、恢复、每天清理到期的。
// 删除在比赛管理里点（功能/比赛管理/）；删除、恢复、彻底删除的规则和操作日志都在比赛库的函数里（比赛.*、届次.*），这里只管什么时候调。
//
//   取({ 动作, 编号 }, { db, 操作人, now })   先做动作（没给就只列出），再交回回收站里的东西
//     动作：恢复比赛  比赛和跟它同一次删的届次回来（之前单独删的届次仍在回收站）；不收录名单里的这一条去掉
//           恢复届次  比赛还在回收站时不能单独恢复
//   清理到期(db, { now })   每天结束后由 后台/每日清理.mjs 调：超过 30 天的彻底删除（届次、来源、处理记录连带删，下级比赛断开上级）
// 还没有管理员登录，操作人先由环境给。
import { 比赛, 届次 } from '../../../db/index.mjs';

export const 保留天数 = 30;
const DAY = 24 * 3600 * 1000;
const 全部 = { 包括已删除: true };

const 动作们 = {
  恢复比赛: (db, 编号, 选项) => 比赛.恢复(db, 编号, 选项),
  恢复届次: (db, 编号, 选项) => 届次.恢复(db, 编号, 选项),
};
const 还剩 = (deletedAt, now) => Math.max(0, 保留天数 - Math.floor((now.getTime() - Date.parse(deletedAt)) / DAY));

function 列出(db, 现在) {
  const 删了的比赛 = db.find('competition', { deleted_at: { isNull: false } }, { orderBy: 'deleted_at', ...全部 });
  const 比赛们 = 删了的比赛.map(c => ({
    id: c.id, name: c.name,
    届次数: db.count('edition', { competition_id: c.id, deleted_at: c.deleted_at }, 全部),
    deleted_at: c.deleted_at, deleted_by: c.deleted_by, 还剩天数: 还剩(c.deleted_at, 现在),
  }));
  const 删了的比赛编号 = new Set(删了的比赛.map(c => c.id));
  const 届次们 = db.find('edition', { deleted_at: { isNull: false } }, { orderBy: 'deleted_at', ...全部 })
    .filter(e => !删了的比赛编号.has(e.competition_id))
    .map(e => ({ id: e.id, edition_name: e.edition_name, competition_id: e.competition_id, deleted_at: e.deleted_at, deleted_by: e.deleted_by, 理由: e.deleted_by?.startsWith('维护') ? (e.status_reason || []).at(-1) ?? '' : '', 还剩天数: 还剩(e.deleted_at, 现在) }));
  return { 比赛们, 届次们 };
}

export async function 取({ 动作, 编号 } = {}, { db, 操作人 = '管理员', now = () => new Date() }) {
  const 现在 = now();
  let 结果 = null;
  if (动作) {
    if (!Object.hasOwn(动作们, 动作)) throw new Error(`不认识的动作：${动作}`);
    结果 = { 动作, 编号, ...动作们[动作](db, 编号, { 操作人, at: 现在.toISOString() }) };
  }
  return { ...列出(db, 现在), 结果 };
}

export function 清理到期(db, { now = () => new Date() } = {}) {
  const 现在 = now();
  const 到期 = { deleted_at: { lt: new Date(现在.getTime() - 保留天数 * DAY).toISOString() } };
  const 选项 = { at: 现在.toISOString() };
  const 结果 = { 比赛: 0, 届次: 0 };
  for (const c of db.find('competition', 到期, { orderBy: 'deleted_at', ...全部 })) { 比赛.彻底删除(db, c.id, 选项); 结果.比赛 += 1; }
  for (const e of db.find('edition', 到期, { orderBy: 'deleted_at', ...全部 })) { 届次.彻底删除(db, e.id, 选项); 结果.届次 += 1; }
  return 结果;
}
