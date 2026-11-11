-- 由 结构/生成.mjs 按 描述/ 生成，不要手改。上线后改表一律新增编号文件。

-- 比赛（一级）
CREATE TABLE competition (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  aliases TEXT,
  website TEXT,
  parent_id TEXT REFERENCES competition(id) DEFERRABLE INITIALLY DEFERRED,
  level TEXT NOT NULL,
  organizer TEXT,
  region TEXT,
  professions TEXT,
  objective_tags TEXT,
  lifecycle TEXT,
  recognition TEXT,
  curation_list TEXT,
  last_maintained_at TEXT,
  manual_fields TEXT,
  deleted_at TEXT,
  deleted_by TEXT,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_competition_last_maintained_at ON competition(last_maintained_at);
CREATE INDEX idx_competition_deleted_at ON competition(deleted_at);
CREATE INDEX idx_competition_parent_id ON competition(parent_id);
CREATE INDEX idx_competition_level ON competition(level);

-- 届次（二级）
CREATE TABLE edition (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL REFERENCES competition(id) DEFERRABLE INITIALLY DEFERRED,
  ordinal INTEGER NOT NULL,
  edition_name TEXT NOT NULL,
  edition_year TEXT,
  edition_ordinal TEXT,
  level TEXT,
  organizer TEXT,
  participants TEXT,
  eligibility TEXT,
  format_and_rules TEXT,
  participation_format TEXT NOT NULL,
  team_size TEXT,
  team_size_category TEXT NOT NULL,
  registration_method TEXT,
  registration_organization TEXT NOT NULL,
  registration_url TEXT,
  fees TEXT,
  fee_type TEXT NOT NULL,
  registration_start TEXT,
  registration_end TEXT,
  competition_start TEXT,
  competition_end TEXT,
  pending_announcement INTEGER NOT NULL,
  status_override TEXT,
  status_override_reason TEXT,
  time_note TEXT,
  track_name TEXT,
  track_scope_note TEXT,
  reward_amount INTEGER,
  reward_tier TEXT,
  reward_highlights TEXT,
  rewards TEXT,
  participant_count INTEGER,
  participant_unit TEXT,
  scale_tier TEXT,
  participant_scale TEXT,
  recommendation TEXT,
  status TEXT NOT NULL,
  status_reason TEXT,
  status_at TEXT,
  last_verified_at TEXT,
  manual_fields TEXT,
  legacy TEXT,
  discovery TEXT,
  discovery_notice_url TEXT,
  notice_resolution TEXT,
  poster TEXT,
  poster_candidates TEXT,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  deleted_at TEXT,
  deleted_by TEXT,
  UNIQUE (competition_id, ordinal)
);
CREATE INDEX idx_edition_competition_id ON edition(competition_id);
CREATE INDEX idx_edition_registration_end ON edition(registration_end);
CREATE INDEX idx_edition_status ON edition(status);
CREATE INDEX idx_edition_deleted_at ON edition(deleted_at);

-- 信息来源
CREATE TABLE source (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES edition(id) DEFERRABLE INITIALLY DEFERRED,
  url TEXT NOT NULL,
  final_url TEXT,
  source_type TEXT NOT NULL,
  is_official INTEGER NOT NULL,
  validity_status TEXT NOT NULL,
  title TEXT,
  published_at TEXT,
  content_summary TEXT,
  supports_fields TEXT,
  review_reason TEXT,
  evidence_excerpt TEXT,
  last_verified_at TEXT
);
CREATE INDEX idx_source_edition_id ON source(edition_id);
CREATE INDEX idx_source_url ON source(url);

-- AI 和系统的处理记录
CREATE TABLE process_log (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES edition(id) DEFERRABLE INITIALLY DEFERRED,
  kind TEXT NOT NULL,
  at TEXT NOT NULL,
  run_id TEXT,
  detail TEXT NOT NULL
);
CREATE INDEX idx_process_log_edition_id_at ON process_log(edition_id, at);
CREATE INDEX idx_process_log_kind ON process_log(kind);

-- 后台操作记录
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  action TEXT NOT NULL,
  table_name TEXT,
  record_id TEXT,
  detail TEXT
);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);
CREATE INDEX idx_audit_log_record_id ON audit_log(record_id);

-- 不收录的比赛
CREATE TABLE blocked_competition (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  aliases TEXT,
  website TEXT,
  competition_id TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX idx_blocked_competition_name ON blocked_competition(name);
CREATE INDEX idx_blocked_competition_competition_id ON blocked_competition(competition_id);

-- 寻找流程拒过的网址
CREATE TABLE rejected_url (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  url_key TEXT NOT NULL,
  title TEXT,
  reason TEXT NOT NULL,
  module TEXT NOT NULL,
  run_id TEXT,
  rejected_at TEXT NOT NULL
);
CREATE INDEX idx_rejected_url_url_key ON rejected_url(url_key);
CREATE INDEX idx_rejected_url_rejected_at ON rejected_url(rejected_at);

-- 后台状态
CREATE TABLE admin_state (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
