// 生产 Linux 使用内核 flock：整个流水线及其子进程共享锁，退出后自动释放。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const LOCK_CHILD_FLAG = 'DAILY_CONTEST_CRAWL_LOCK_CHILD';
export function runWithPipelineLock({ directory, script, args = [], env = process.env, spawn = spawnSync, platform = process.platform }) {
  if (platform === 'win32') throw new Error('抓取流水线只在生产 Linux 执行；请在服务器运行以使用 flock 互斥');
  fs.mkdirSync(directory, { recursive:true });
  const result = spawn('flock', ['-n', '-E', '75', path.join(directory, 'crawl-pipeline.flock'), process.execPath, script, ...args], {
    stdio:'inherit', env:{ ...env, [LOCK_CHILD_FLAG]:'1' },
  });
  if (result.error) throw result.error;
  if (result.status === 75) throw new Error('抓取流水线已在运行，拒绝并行执行');
  if (result.signal) throw new Error(`抓取锁进程异常结束：${result.signal}`);
  return result.status ?? 1;
}
