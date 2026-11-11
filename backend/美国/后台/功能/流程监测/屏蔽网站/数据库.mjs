// 屏蔽网站 · 取数据和操作（美国服务器上跑）：百度搜索的屏蔽名单（2026-11-02 照旧后台搬）。规则和存放在比赛库的 屏蔽网站.*，这里只管什么时候调。
//
//   取({ host, decision, note }, { db, now })   先做操作（没给就只读），再交回现在的名单
//     decision：block 确认屏蔽、dismiss 不屏蔽（这两个从建议里来）、unblock 取消屏蔽、restore 恢复（把不屏蔽的放回去，下次统计可能再建议）
import { 屏蔽网站 } from '../../../../db/index.mjs';

// 旧后台把这些错误码换成中文提示，这里直接报中文
const 中文 = { invalid_site_host: '不是网站域名', invalid_site_decision: '不认识的操作', site_already_builtin: '已经在内置名单里', site_not_blocked: '这个网站没有屏蔽' };

export async function 取({ host, decision, note } = {}, { db, now = () => new Date() }) {
  if (!decision) return { ...屏蔽网站.读状态(db), 结果: null };
  try {
    return { ...屏蔽网站.决定(db, { host, decision, note }, { now }), 结果: { host: 屏蔽网站.normalizeHost(host), decision } };
  } catch (error) {
    throw new Error(中文[error.message] || error.message);
  }
}
