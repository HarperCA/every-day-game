-- 2026-11-07：新维护的搜索记忆，每个比赛一份 Markdown（官方域名、通知列表页、往年通知标题格式、成功过的搜索词、往年真实发布日期、最多 3 条教训）。
-- 单独一张表，改记忆不动比赛的版本号，公开比赛同步不会因此重推。比赛彻底删除时连带删。
CREATE TABLE search_memory (
  id TEXT PRIMARY KEY REFERENCES competition(id) DEFERRABLE INITIALLY DEFERRED,
  content TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
