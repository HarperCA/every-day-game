// 运行锁：维护每 5 分钟启动一次，不叠着跑；每晚流程还在跑时也跳过这一轮（两边都写比赛库，避开最好）。
//
//   拿锁(锁文件, { now }) → 放锁的函数；上一次还拿着（没超过 1 小时）就交回 null
//   流程在跑(流程锁文件, { now }) → 每晚流程的锁文件在、没超过 12 小时就是 true
//     流程锁文件由调用方给（默认 PIPELINE_LOG_DIR/.运行中.lock）：维护不引用寻找流程的代码，只看这个文件
import fs from 'node:fs';

export const 锁过期毫秒 = 3600 * 1000;
export const 流程锁过期毫秒 = 12 * 3600 * 1000;

const 读锁 = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

export function 拿锁(file, { now = new Date() } = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: now.toISOString() }), { flag: 'wx' });
      return () => fs.rmSync(file, { force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const held = 读锁(file);
      if (!(now.getTime() - Date.parse(held?.at || 0) > 锁过期毫秒)) return null;
      fs.rmSync(file, { force: true });   // 超过 1 小时没放，视为上次异常退出留下的
    }
  }
  return null;
}

export function 流程在跑(file, { now = new Date() } = {}) {
  if (!fs.existsSync(file)) return false;
  const held = 读锁(file);
  return now.getTime() - Date.parse(held?.at || 0) <= 流程锁过期毫秒;
}
