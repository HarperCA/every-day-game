// 命令行入口。定时器每天 9:00–18:00 每 5 分钟调一次（见 backend/美国/定时/），每次维护一个比赛（2026-11-01 用户定）。
//
//   node backend/美国/db/维护/run.mjs                    维护下一个比赛：7 天内没维护过、上次维护最早的，做完记下时间
//   node backend/美国/db/维护/run.mjs --比赛 event-cmp004   指定维护某个比赛（不看 7 天）
//   node backend/美国/db/维护/run.mjs --全部             全部比赛一起跑一遍（手动用）
//   node backend/美国/db/维护/run.mjs --dry-run          试跑：照常审计和分流，不写比赛库、不记维护时间
//   node backend/美国/db/维护/run.mjs --only 状态         只跑某几项检查（可以写多个 --only）
//   node backend/美国/db/维护/run.mjs --批 100            AI 审查一批：先跑后台队列，再挑 100 个比赛（待人工审核优先），只跑核对原文（见 批量.mjs）
//   node backend/美国/db/维护/run.mjs --队列              只跑后台多选的队列，空的马上退出
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
import { openDb, 维护队列 } from '../index.mjs';
import { runMaintenance } from './index.mjs';
import { 维护一个比赛 } from './轮流.mjs';
import { 批量维护 } from './批量.mjs';
import { 拿锁, 流程在跑, 续锁 } from './运行锁.mjs';
import { 从环境造读网页 } from './北京读网页.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { dryRun: false, only: undefined, 全部: false, 比赛编号: null, 批: null, 队列: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--only') (args.only ||= []).push(argv[++i]);
    else if (argv[i] === '--全部') args.全部 = true;
    else if (argv[i] === '--比赛') args.比赛编号 = argv[++i];
    else if (argv[i] === '--批') args.批 = Number(argv[++i]);
    else if (argv[i] === '--队列') args.队列 = true;
    else throw new Error(`不认识的参数：${argv[i]}`);
  }
  if (args.全部 && args.比赛编号) throw new Error('--全部 和 --比赛 只能选一个');
  if (args.批 !== null && !(Number.isInteger(args.批) && args.批 > 0)) throw new Error('--批 要给正整数');
  return args;
}

function 队列是空的() {
  const db = openDb({ readOnly: true });
  try { return !维护队列.读(db).排队.length; } finally { db.close(); }
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
  } else if (args.队列 && 队列是空的()) {
    // 每 2 分钟一次，空的不写日志也不拿锁
  } else if (!(放锁 = 拿锁(path.join(logDir, '.维护中.lock')))) {
    log.info('上一次维护还没完，这一轮跳过');
  } else {
    const db = openDb({ readOnly: args.dryRun });
    try {
      const web = { 读网页: 从环境造读网页(读网页) };
      const 共用 = { db, log, ai, web, only: args.only, dryRun: args.dryRun };
      if (args.批 !== null || args.队列) {
        const 回 = await 批量维护({ db, log, ai, web, dryRun: args.dryRun, 上限: args.批 ?? 0, 只队列: args.队列,
          该停: () => 流程在跑(流程锁), 续锁: () => 续锁(path.join(logDir, '.维护中.lock')) });
        console.log(`AI 审查：跑了 ${回.跑了} 个（手动 ${回.手动}，自动 ${回.自动}），失败 ${回.失败}${回.停因 ? `；${回.停因}` : ''}`);
        process.exitCode = 0;
      } else {
      const result = args.全部 ? await runMaintenance(共用) : await 维护一个比赛({ ...共用, 比赛编号: args.比赛编号 });
      if (result.比赛 === null) console.log(`没有要维护的比赛：${result.原因}`);
      else console.log(`${result.比赛 ? `比赛 ${result.比赛}：` : ''}检查完成：${result.检查.完成.join('、') || '无'}；失败：${result.检查.失败.map(f => f.name).join('、') || '无'}；改正 ${result.处理.改正}，转人工 ${result.处理.人工}，留着 ${result.处理.留着}`);
      process.exitCode = result.commit?.error ? 1 : 0;
      }
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
