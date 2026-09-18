// SQLite 存储层：通用文档存储，和 CloudBase 的集合语义 1:1。
//
// 为什么不建 7 张各自带字段的表：那样要把每个集合的字段一一映射，
// 映射就有出错的机会，而迁移最不能出的错就是静默丢字段。文档存储
// （集合名 + 文档 id + 整个 JSON）和 CloudBase 本来的形态完全一样，
// 业务代码可以原样跑，不改一行。
//
// 数据量是 93 条记录这个级别，查询在 JS 里做完全够；真到了需要索引的
// 那天再谈规范化，现在为性能做设计是空想。
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  collection TEXT NOT NULL,
  id         TEXT NOT NULL,
  data       TEXT NOT NULL,
  seq        INTEGER,
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents(collection);

-- 自增序号，用来复刻 CloudBase 里「插入顺序」这个隐含语义
-- （audit_log 按时间倒序取最近 100 条时要用）。
CREATE TABLE IF NOT EXISTS seq_counter (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);
`;

export function openDatabase(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  // WAL：读写不互相阻塞，崩溃恢复也更稳。
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

export function nextSeq(db) {
  db.prepare("INSERT INTO seq_counter (name, value) VALUES ('doc', 1) ON CONFLICT(name) DO UPDATE SET value = value + 1").run();
  return db.prepare("SELECT value FROM seq_counter WHERE name = 'doc'").get().value;
}

export function getDoc(db, collection, id) {
  const row = db.prepare('SELECT data FROM documents WHERE collection = ? AND id = ?').get(collection, id);
  return row ? JSON.parse(row.data) : null;
}

export function putDoc(db, collection, id, data) {
  const existing = db.prepare('SELECT seq FROM documents WHERE collection = ? AND id = ?').get(collection, id);
  const seq = existing ? existing.seq : nextSeq(db);
  db.prepare(`
    INSERT INTO documents (collection, id, data, seq) VALUES (@collection, @id, @data, @seq)
    ON CONFLICT(collection, id) DO UPDATE SET data = @data
  `).run({ collection, id, data: JSON.stringify(data), seq });
}

export function deleteDoc(db, collection, id) {
  const info = db.prepare('DELETE FROM documents WHERE collection = ? AND id = ?').run(collection, id);
  return info.changes;
}

export function listDocs(db, collection) {
  return db.prepare('SELECT id, data, seq FROM documents WHERE collection = ? ORDER BY seq ASC').all(collection)
    .map(row => ({ ...JSON.parse(row.data), _id: row.id }));
}

export function countDocs(db, collection) {
  return db.prepare('SELECT COUNT(*) AS n FROM documents WHERE collection = ?').get(collection).n;
}

export function listCollections(db) {
  return db.prepare('SELECT collection, COUNT(*) AS n FROM documents GROUP BY collection ORDER BY collection').all();
}
