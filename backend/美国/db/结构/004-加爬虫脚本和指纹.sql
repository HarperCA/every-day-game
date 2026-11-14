-- 2026-11-08：新维护的爬虫脚本（Codex 写的步骤，程序照着取通知列表）和指纹记录（通知列表上次的样子），每个比赛各一行。
-- 单独两张表，改它们不动比赛的版本号，公开比赛同步不会因此重推。比赛彻底删除时连带删。
CREATE TABLE crawl_script (
  id TEXT PRIMARY KEY REFERENCES competition(id) DEFERRABLE INITIALLY DEFERRED,
  list_url TEXT NOT NULL,
  steps TEXT NOT NULL,
  needs_browser INTEGER NOT NULL,
  written_by TEXT,
  prompt_version TEXT,
  last_ok_at TEXT,
  fail_count INTEGER NOT NULL,
  last_error TEXT,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
CREATE TABLE page_fingerprint (
  id TEXT PRIMARY KEY REFERENCES competition(id) DEFERRABLE INITIALLY DEFERRED,
  list_url TEXT NOT NULL,
  etag TEXT,
  last_modified TEXT,
  hash TEXT NOT NULL,
  items TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
