// 用独立的 SQLite 写事务互斥，同一台机器上的进程退出时由系统释放文件锁。
import fs from 'node:fs';
import path from 'node:path';
import { openSqlite } from './sqlite.mjs';

export function 拿锁(目录) {
  fs.mkdirSync(目录, { recursive: true });
  const db = openSqlite(path.join(目录, '.维护中.sqlite'), { timeout: 0, wal: false });
  try {
    db.exec('BEGIN IMMEDIATE');
  } catch (error) {
    db.close();
    if (error.code === 'SQLITE_BUSY') return null;
    throw error;
  }
  return () => db.close();
}

export const 流程锁过期毫秒 = 12 * 3600 * 1000;

const 读锁 = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

export function 流程在跑(file, { now = new Date() } = {}) {
  if (!fs.existsSync(file)) return false;
  const held = 读锁(file);
  return now.getTime() - Date.parse(held?.at || 0) <= 流程锁过期毫秒;
}
