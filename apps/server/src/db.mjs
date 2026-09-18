// SQLite 存储层，复刻 CloudBase 那 7 个集合的语义。
//
// 为什么是 SQLite：数据量是 58 条记录这个级别，单文件、ACID 事务、
// 备份就是复制文件。admin_state 那套「整表 JSON + 版本号乐观锁」
// 映射成一行一列几乎 1:1；favorite/reminder 这类要真查询的也扛得住。
//
// 一条纪律：这一层只负责存取，不含任何业务判断。发布闸、收录门槛、
// 审核这些逻辑仍然在原来的模块里（competitionValue / publicCache / ...），
// 迁移不改业务语义，只换存储。
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
-- 整表 JSON + 版本号。id 取 'competitions' | 'feedbacks' | 'ai_jobs' 等，
-- 和 CloudBase 里 admin_state 集合的文档 id 一一对应。
CREATE TABLE IF NOT EXISTS admin_state (
  id          TEXT PRIMARY KEY,
  records     TEXT NOT NULL DEFAULT '[]',   -- JSON 数组
  version     INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT,
  updated_by  TEXT
);

-- 不走版本号的杂项文档（AI 运行日志、提醒调用日志），原来也塞在 admin_state 里。
CREATE TABLE IF NOT EXISTS admin_doc (
  id    TEXT PRIMARY KEY,
  data  TEXT NOT NULL DEFAULT '{}'          -- JSON 对象
);

-- 已发布赛事，小程序只读这张表。
CREATE TABLE IF NOT EXISTS event_edition_public_cache (
  id    TEXT PRIMARY KEY,
  data  TEXT NOT NULL                       -- JSON 对象（toPublicCache 的产物）
);

CREATE TABLE IF NOT EXISTS audit_log (
  id    TEXT PRIMARY KEY,
  data  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_account (
  id            TEXT PRIMARY KEY,
  openid        TEXT NOT NULL UNIQUE,        -- 唯一索引：并发首次登录只会建一个账号
  appid         TEXT,
  unionid       TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TEXT,
  updated_at    TEXT,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS favorite (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  edition_id TEXT NOT NULL,
  data       TEXT NOT NULL,
  UNIQUE(user_id, edition_id)
);
CREATE INDEX IF NOT EXISTS idx_favorite_user ON favorite(user_id);

CREATE TABLE IF NOT EXISTS reminder (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  edition_id TEXT,
  data       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminder_user ON reminder(user_id);
CREATE INDEX IF NOT EXISTS idx_reminder_edition ON reminder(edition_id);

CREATE TABLE IF NOT EXISTS feedback (
  id      TEXT PRIMARY KEY,
  user_id TEXT,
  data    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id);
`;

export function openDatabase(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  // WAL：读写不互相阻塞；单机单进程也用得上，崩溃恢复更稳。
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

// —— admin_state：整表 JSON + 版本号 ——

export function readState(db, id) {
  const row = db.prepare('SELECT records, version, updated_at, updated_by FROM admin_state WHERE id = ?').get(id);
  if (!row) return { records: [], version: 0, updated_at: null, updated_by: null };
  return {
    records: JSON.parse(row.records),
    version: row.version,
    updated_at: row.updated_at,
    updated_by: row.updated_by,
  };
}

export function writeState(db, id, records, version, updatedBy = 'super_admin') {
  db.prepare(`
    INSERT INTO admin_state (id, records, version, updated_at, updated_by)
    VALUES (@id, @records, @version, @updated_at, @updated_by)
    ON CONFLICT(id) DO UPDATE SET
      records = @records, version = @version, updated_at = @updated_at, updated_by = @updated_by
  `).run({
    id,
    records: JSON.stringify(records),
    version,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  });
}

// —— admin_doc：不走版本号的杂项文档 ——

export function readDoc(db, id) {
  const row = db.prepare('SELECT data FROM admin_doc WHERE id = ?').get(id);
  return row ? JSON.parse(row.data) : null;
}

export function writeDoc(db, id, data) {
  db.prepare('INSERT INTO admin_doc (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data')
    .run(id, JSON.stringify(data));
}

// —— 公开缓存 ——

export function listPublicCache(db) {
  return db.prepare('SELECT data FROM event_edition_public_cache').all().map(row => JSON.parse(row.data));
}

export function getPublicCache(db, id) {
  const row = db.prepare('SELECT data FROM event_edition_public_cache WHERE id = ?').get(id);
  return row ? JSON.parse(row.data) : null;
}

export function putPublicCache(db, id, data) {
  db.prepare('INSERT INTO event_edition_public_cache (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data')
    .run(id, JSON.stringify(data));
}

export function removePublicCache(db, id) {
  db.prepare('DELETE FROM event_edition_public_cache WHERE id = ?').run(id);
}

// —— 审计 ——

export function appendAudit(db, entry) {
  db.prepare('INSERT INTO audit_log (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data')
    .run(entry.id, JSON.stringify(entry));
}

export function listAudit(db, limit = 200) {
  return db.prepare('SELECT data FROM audit_log ORDER BY rowid DESC LIMIT ?').all(limit).map(row => JSON.parse(row.data));
}
