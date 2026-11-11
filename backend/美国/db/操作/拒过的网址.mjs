// 拒过的网址的常用操作。只管存取，不做业务判断；新增由寻找流程在改动里提，总控统一提交。
//   近期(db, { now })        30 天内拒过的，新的在前
//   清理过期(db, { now })    删掉超过 30 天的，交回删了几条（每日清理调用）
export const 保留天数 = 30;

const 界线 = now => new Date(now.getTime() - 保留天数 * 86400000).toISOString();

export function 近期(db, { now = new Date() } = {}) {
  return db.find('rejected_url', { rejected_at: { gte: 界线(now) } }, { orderBy: '-rejected_at' });
}

export function 清理过期(db, { now = new Date() } = {}) {
  const 过期 = db.find('rejected_url', { rejected_at: { lt: 界线(now) } });
  db.transaction(tx => { for (const row of 过期) tx.remove('rejected_url', row.id); });
  return 过期.length;
}
