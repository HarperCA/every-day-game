// 每日补缺失 · 命令行入口。定时器每天 10:00（北京时间）调一次，见 backend/美国/定时/competition-radar-fill.*。
//   node backend/美国/db/维护/补缺失/run.mjs              挑最有用的 20 个缺字段的记录，交给 Codex 补
//   node backend/美国/db/维护/补缺失/run.mjs --上限 5     改每天补几个
//   node backend/美国/db/维护/补缺失/run.mjs --dry-run    试跑：照样挑、照样问 Codex（会花额度），但不写比赛库、不记查过的时间
// 和轮流维护共用一把锁（MAINTAIN_LOG_DIR/.维护中.lock），每晚流程还在跑（PIPELINE_LOG_DIR/.运行中.lock）也跳过；日志写进 MAINTAIN_LOG_DIR。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../../../../共用/工具/log.mjs';
import * as ai from '../../../ai/index.mjs';
import { 读网页 } from '../../../web/index.mjs';
import { openDb } from '../../index.mjs';
import { 拿锁, 流程在跑 } from '../运行锁.mjs';
import { 默认上限, 每日补缺失 } from './index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const 参数 = process.argv.slice(2);
const 试跑 = 参数.includes('--dry-run');
const 上限 = 参数.includes('--上限') ? Number(参数[参数.indexOf('--上限') + 1]) : 默认上限;

let 放锁 = null;
try {
  if (!Number.isInteger(上限) || 上限 < 1) throw new Error('--上限 要是正整数');
  const logDir = process.env.MAINTAIN_LOG_DIR || path.join(HERE, '..', '日志');
  fs.mkdirSync(logDir, { recursive: true });
  const log = createLogger(path.join(logDir, `${new Date().toISOString().slice(0, 10)}.log`), { console: true, module: '补缺失' });
  const 流程锁 = path.join(process.env.PIPELINE_LOG_DIR || path.join(HERE, '..', '..', '..', 'pipeline', '日志'), '.运行中.lock');
  if (流程在跑(流程锁)) log.info('每晚流程还在跑，今天的补缺失跳过');
  else if (!(放锁 = 拿锁(path.join(logDir, '.维护中.lock')))) log.info('维护还在跑，今天的补缺失跳过');
  else {
    const db = openDb({ readOnly: 试跑 });
    try {
      const { 挑了, 结果 } = await 每日补缺失({ db, ai, web: { 读网页 }, log, 上限, 试跑, 状态文件: path.join(logDir, '补缺失状态.json') });
      console.log(`补缺失${试跑 ? '（试跑，没写）' : ''}：查了 ${挑了.length} 条；改正 ${结果.处理.改正}，转人工 ${结果.处理.人工}，留着 ${结果.处理.留着}`);
      process.exitCode = 结果.commit?.error ? 1 : 0;
    } finally {
      db.close();
    }
  }
} catch (error) {
  console.error(`补缺失没能运行：${error?.message || error}`);
  process.exitCode = 1;
} finally {
  放锁?.();
}
