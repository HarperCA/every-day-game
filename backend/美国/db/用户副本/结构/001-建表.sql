-- 由 结构/生成.mjs 按 描述/ 生成，不要手改。上线后改表一律新增编号文件。

-- 北京用户数据的只读副本
CREATE TABLE beijing_copy (
  id TEXT PRIMARY KEY,
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  data TEXT NOT NULL,
  round TEXT,
  synced_at TEXT NOT NULL
);
CREATE INDEX idx_beijing_copy_table_name ON beijing_copy(table_name);
