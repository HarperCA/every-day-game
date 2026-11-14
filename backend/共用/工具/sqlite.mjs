// 打开 SQLite 数据库。用 better-sqlite3，装在 backend/Environment/ 里（版本见那里的 package.json）。
// 第三方库只装在 Environment/，所以这里按 Environment/package.json 的位置去找，不依赖仓库里别的文件夹。
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(HERE, '..', '..', 'Environment', 'package.json'));
const Database = require('better-sqlite3');

// wal：默认开 WAL；运行锁.mjs 只拿它当文件锁用，传 wal: false 不切换日志模式（2026-11-11 线上加）
export function openSqlite(file, { wal = true, ...options } = {}) {
  const db = new Database(file, options);
  if (wal && file !== ':memory:' && !options.readonly) db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
