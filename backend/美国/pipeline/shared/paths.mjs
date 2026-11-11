// 统一路径：每晚的运行文件夹放在哪、叫什么名字、保留多久。
//
// 本地开发时日志放在 backend/美国/pipeline/日志/；服务器上代码和数据分开放，
// 用环境变量 PIPELINE_LOG_DIR 指到数据目录（例如 /opt/daily-contest/data/日志）。
// 文件夹按北京时间的日期命名：服务器是 UTC，北京凌晨 1 点在 UTC 还是前一天。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PIPELINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const KEEP_DAYS = 90;
const DAY_MS = 24 * 3600 * 1000;
const RUN_FOLDER = /^(\d{4}-\d{2}-\d{2})(?:-(\d{2}))?$/;

export function logRoot(override) {
  return override || process.env.PIPELINE_LOG_DIR || path.join(PIPELINE_DIR, '日志');
}

// 北京时间的日期，YYYY-MM-DD
export function beijingDate(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// 当天第一次运行叫 2026-10-29，同一天再跑依次是 2026-10-29-02、-03……不覆盖之前的结果
export function nextRunFolder(root, now = new Date()) {
  const date = beijingDate(now);
  const used = fs.existsSync(root) ? fs.readdirSync(root).filter(name => name === date || name.startsWith(`${date}-`)) : [];
  if (!used.length) return path.join(root, date);
  const max = Math.max(1, ...used.map(name => Number(RUN_FOLDER.exec(name)?.[2] || 1)));
  return path.join(root, `${date}-${String(max + 1).padStart(2, '0')}`);
}

// 删掉超过保留天数的运行文件夹。只认“日期”或“日期-序号”这样命名的文件夹，别的东西不碰。
export function removeExpiredRuns(root, { now = new Date(), keepDays = KEEP_DAYS } = {}) {
  if (!fs.existsSync(root)) return [];
  const cutoff = beijingDate(new Date(now.getTime() - keepDays * DAY_MS));
  const removed = [];
  for (const name of fs.readdirSync(root)) {
    const match = RUN_FOLDER.exec(name);
    if (!match || match[1] >= cutoff) continue;
    fs.rmSync(path.join(root, name), { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

export function runFiles(runDir) {
  return {
    db: path.join(runDir, 'run.db'),
    log: path.join(runDir, 'run.log'),
    report: path.join(runDir, 'report.md'),
  };
}
