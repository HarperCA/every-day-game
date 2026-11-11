-- 由 结构/生成.mjs 按 描述/ 生成，不要手改。上线后改表一律新增编号文件。

-- 公开比赛（美国比赛库的副本）
CREATE TABLE public_competition (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  level TEXT,
  source_version INTEGER NOT NULL,
  data TEXT NOT NULL,
  synced_at TEXT NOT NULL
);
CREATE INDEX idx_public_competition_level ON public_competition(level);

-- 公开届次（美国比赛库的副本）
CREATE TABLE public_edition (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL REFERENCES public_competition(id) DEFERRABLE INITIALLY DEFERRED,
  registration_start TEXT,
  registration_end TEXT,
  status TEXT NOT NULL,
  source_version INTEGER NOT NULL,
  data TEXT NOT NULL,
  synced_at TEXT NOT NULL
);
CREATE INDEX idx_public_edition_competition_id ON public_edition(competition_id);
CREATE INDEX idx_public_edition_registration_end ON public_edition(registration_end);
CREATE INDEX idx_public_edition_status ON public_edition(status);
