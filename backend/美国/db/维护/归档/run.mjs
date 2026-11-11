// 每日归档 · 命令行入口。定时器每天 2:00（北京时间）调一次，见 backend/美国/定时/competition-radar-archive.*。
//   node backend/美国/db/维护/归档/run.mjs            把报名已截止的已发布届次全部归档，算下一届预计
//   node backend/美国/db/维护/归档/run.mjs --dry-run  试跑：只列出会归哪些，比赛库只读打开，什么都不写
// 不看每晚流程在不在跑：归档很快，每一届一个事务、带版本号，被别人改过的那届跳过、明天再归。
import { openDb } from '../../index.mjs';
import { 每日归档 } from './index.mjs';

const 试跑 = process.argv.includes('--dry-run');
const db = openDb({ readOnly: 试跑 });
try {
  const 结果 = 每日归档(db, { 试跑 });
  console.log(`${new Date().toISOString()} 每日归档${试跑 ? '（试跑，没写）' : ''}：已发布 ${结果.检查了} 届，归档 ${结果.归档了.length} 届，失败 ${结果.失败.length} 届`);
  for (const x of 结果.归档了) console.log(`  归档 ${x.id}（${x.名称}），下一届预计 ${x.下一届预计 ?? '算不出'}`);
  for (const x of 结果.失败) console.log(`  失败 ${x.id}：${x.原因}`);
  if (结果.失败.length) process.exitCode = 1;
} finally {
  db.close();
}
