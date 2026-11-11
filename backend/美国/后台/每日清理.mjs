// 每天结束后跑一次：回收站里超过 30 天的比赛和届次彻底删除，每删一个在后台记录里留一条操作日志；
// 寻找流程拒过的网址超过 30 天的删掉（到期后对比去重不再挡，页面变了还能重新判断）。
// 回收站的规则在 功能/回收站/数据库.mjs，拒过的网址在 db/操作/拒过的网址.mjs；这里只负责打开比赛库、调用、打印结果。定时器部署时再配。
//   node backend/美国/后台/每日清理.mjs
import { openDb, 拒过的网址 } from '../db/index.mjs';
import { 清理到期 } from './功能/回收站/数据库.mjs';

const db = openDb();
try {
  const 结果 = 清理到期(db);
  console.log(`回收站清理：彻底删除比赛 ${结果.比赛} 个、单独删的届次 ${结果.届次} 届（明细见后台记录）`);
  console.log(`拒过的网址：删掉超过 ${拒过的网址.保留天数} 天的 ${拒过的网址.清理过期(db)} 条`);
} catch (error) {
  console.error(`回收站清理失败：${error?.message || error}`);
  process.exitCode = 1;
} finally {
  db.close();
}
