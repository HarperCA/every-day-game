// 命令行入口。定时器每天 9:00–18:00 每 5 分钟调一次（见 backend/美国/定时/），每次维护一个比赛（2026-11-01 用户定）。
//
//   node backend/美国/db/维护/run.mjs                    维护下一个比赛：7 天内没维护过、上次维护最早的，做完记下时间
//   node backend/美国/db/维护/run.mjs --比赛 event-cmp004   指定维护某个比赛（不看 7 天）
//   node backend/美国/db/维护/run.mjs --全部             全部比赛一起跑一遍（手动用）
//   node backend/美国/db/维护/run.mjs --dry-run          试跑：照常审计和分流，不写比赛库、不记维护时间
//   node backend/美国/db/维护/run.mjs --only 状态         只跑某几项检查（可以写多个 --only）
//
// 不叠着跑：上一次还没完（锁文件 日志/.维护中.lock）就跳过；每晚流程还在跑（PIPELINE_LOG_DIR/.运行中.lock）也跳过这一轮。
// 日志写进 MAINTAIN_LOG_DIR（默认本文件夹下的 日志/，不进 git），每天一个文件。
// AI 总管、读网页已接上（密钥只在服务器上）；检查项和查找还是占位。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../../../共用/工具/log.mjs';
import * as ai from '../../ai/index.mjs';
import { 读网页 } from '../../web/index.mjs';
import { openDb } from '../index.mjs';
import { runMaintenance } from './index.mjs';
import { 维护一个比赛 } from './轮流.mjs';
import { 拿锁, 流程在跑 } from './运行锁.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { dryRun: false, only: undefined, 全部: false, 比赛编号: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--only') (args.only ||= []).push(argv[++i]);
    else if (argv[i] === '--全部') args.全部 = true;
    else if (argv[i] === '--比赛') args.比赛编号 = argv[++i];
    else throw new Error(`不认识的参数：${argv[i]}`);
  }
  if (args.全部 && args.比赛编号) throw new Error('--全部 和 --比赛 只能选一个');
  return args;
}

let 放锁 = null;
try {
  const args = parseArgs(process.argv.slice(2));
  const logDir = process.env.MAINTAIN_LOG_DIR || path.join(HERE, '日志');
  fs.mkdirSync(logDir, { recursive: true });
  const log = createLogger(path.join(logDir, `${new Date().toISOString().slice(0, 10)}.log`), { console: true, module: '维护' });
  const 流程锁 = path.join(process.env.PIPELINE_LOG_DIR || path.join(HERE, '..', '..', 'pipeline', '日志'), '.运行中.lock');
  if (流程在跑(流程锁)) {
    log.info('每晚流程还在跑，这一轮维护跳过');
  } else if (!(放锁 = 拿锁(path.join(logDir, '.维护中.lock')))) {
    log.info('上一次维护还没完，这一轮跳过');
  } else {
    const db = openDb({ readOnly: args.dryRun });
    try {
      const 共用 = { db, log, ai, web: { 读网页 }, only: args.only, dryRun: args.dryRun };
      const result = args.全部 ? await runMaintenance(共用) : await 维护一个比赛({ ...共用, 比赛编号: args.比赛编号 });
      if (result.比赛 === null) console.log(`没有要维护的比赛：${result.原因}`);
      else console.log(`${result.比赛 ? `比赛 ${result.比赛}：` : ''}检查完成：${result.检查.完成.join('、') || '无'}；失败：${result.检查.失败.map(f => f.name).join('、') || '无'}；改正 ${result.处理.改正}，转人工 ${result.处理.人工}，留着 ${result.处理.留着}`);
      process.exitCode = result.commit?.error ? 1 : 0;
    } finally {
      db.close();
    }
  }
} catch (error) {
  console.error(`维护没能运行：${error?.message || error}`);
  process.exitCode = 1;
} finally {
  放锁?.();
}
