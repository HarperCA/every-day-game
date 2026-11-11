// 命令行入口：每晚的定时器只调用这一个文件。
//
//   node backend/美国/pipeline/run.mjs                 正式运行：读写比赛库（美国/db，默认 DB_DIR/比赛库.db），最后由 06 入库的 写入主库 写进去
//   node backend/美国/pipeline/run.mjs --dry-run       试跑：模块照跑，比赛库只读打开，最后不写
//   node backend/美国/pipeline/run.mjs --run <运行文件夹> [--from 05]
//                                                  接着某一晚跑；带 --from 时撤销该模块及之后的结果再重跑
import path from 'node:path';
import * as ai from '../ai/index.mjs';
import { openDb } from '../db/index.mjs';
import { 读网页 } from '../web/index.mjs';
import { runPipeline } from './总控/orchestrator.mjs';
import { logRoot } from './shared/paths.mjs';

function parseArgs(argv) {
  const args = { dryRun: false, runDir: undefined, from: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--run') args.runDir = argv[++i];
    else if (argv[i] === '--from') args.from = argv[++i];
    else throw new Error(`不认识的参数：${argv[i]}`);
  }
  if (args.from && !args.runDir) throw new Error('--from 要和 --run 一起用：指明接着哪一晚跑');
  if (args.runDir && !path.isAbsolute(args.runDir)) args.runDir = path.join(logRoot(), args.runDir);
  return args;
}

// 漏网的异常也要记下来再退出，不能让进程悄悄挂掉
process.on('unhandledRejection', error => { console.error('未处理的异步错误：', error); process.exitCode = 1; });

let mainDb;
try {
  const args = parseArgs(process.argv.slice(2));
  // 主库换成真实的比赛库（2026-11-01）；试跑只读打开，什么都写不进去
  mainDb = openDb({ readOnly: args.dryRun });
  // 接上 AI 总管（密钥只在服务器上：AI_KEYS_DIR 指的密钥目录，本地没有时一调就报“密钥错误”，不会发请求）和读网页（2026-11-01）
  const result = await runPipeline({ ...args, mainDb, ai, web: { 读网页 }, console: true });
  console.log(`运行文件夹：${result.runDir}`);
  console.log(`跑完：${result.ran.join('、') || '无'}；跳过：${result.skipped.join('、') || '无'}${result.stoppedAt ? `；停在：${result.stoppedAt}` : ''}`);
  process.exitCode = result.stoppedAt ? 2 : 0;
} catch (error) {
  console.error(`流程没能运行：${error?.message || error}`);
  process.exitCode = 1;
} finally {
  mainDb?.close();
}
