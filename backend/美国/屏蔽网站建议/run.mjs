// 每周统计建议屏蔽的网站：定时器每周一北京时间 9:00 跑这个文件（美国/定时/competition-radar-site-block.timer）。
//   node backend/美国/屏蔽网站建议/run.mjs                    统计近 30 天，写进比赛库（后台“屏蔽网站”页看建议）
//   node backend/美国/屏蔽网站建议/run.mjs --dry-run          只算、只打印，不写比赛库
//   node backend/美国/屏蔽网站建议/run.mjs --days 30 --min-refs 15
// 每晚的运行文件夹在 PIPELINE_LOG_DIR（默认 backend/美国/pipeline/日志/），比赛库在 DB_DIR。
import { openDb } from '../db/index.mjs';
import { logRoot } from '../pipeline/shared/paths.mjs';
import { MIN_REFS, WINDOW_DAYS, 每周统计 } from './index.mjs';

const args = process.argv.slice(2);
const 数 = (名, 默认) => { const i = args.indexOf(`--${名}`); return i >= 0 ? Number(args[i + 1]) || 默认 : 默认; };
const dryRun = args.includes('--dry-run');
const 天数 = 数('days', WINDOW_DAYS);
const minRefs = 数('min-refs', MIN_REFS);

const db = openDb({ readOnly: dryRun });
try {
  const r = await 每周统计({ db, 根: logRoot(), 天数, minRefs, dryRun });
  console.log(`近 ${天数} 天 ${r.runs} 晚的搜索结果：建议屏蔽 ${r.suggestions.length} 个网站（出现 ≥ ${minRefs} 次且从没被放行或追溯成功）`);
  for (const item of r.suggestions) console.log(`  ${String(item.refs).padStart(4)}  ${item.host}  ${item.reason}`);
  console.log(r.写了 ? `已写进比赛库：建议 ${r.已写.suggestions} 个，已确认屏蔽 ${r.已写.blocked} 个` : '--dry-run：没有写进比赛库');
} catch (error) {
  console.error(`统计建议屏蔽的网站失败：${error?.message || error}`);
  process.exitCode = 1;
} finally {
  db.close();
}
