// 原生表结构——不是 CloudBase 文档模型的翻译，是按这个系统真正的查询方式设计的。
//
// 和迁移脚手架（cloudbase-shim.mjs 的 documents 表）的区别：
// 那边是「一坨 JSON 塞进一列」，为的是让旧代码原样跑；这边热字段提成真列、
// 该有索引有索引，publicData 筛选、提醒扫描这些查询走索引而不是全表拉出来
// 在 JS 里过一遍。
//
// 保留的一件事：records 整表 + 版本号乐观锁。这不是 CloudBase 的遗留——
// 后台是「载入全部、编辑、整体提交」的用法，版本号用来发现并发冲突。
// 存储换成一行一条，但对外的接口契约不变，前端不用跟着改。
export const SCHEMA = `
-- 赛事记录
CREATE TABLE IF NOT EXISTS competitions (
  id                TEXT PRIMARY KEY,
  event_id          TEXT NOT NULL,
  name              TEXT NOT NULL,
  data_status       TEXT NOT NULL,
  system_validation TEXT NOT NULL,
  manual_review     TEXT NOT NULL,
  event_level       TEXT,
  registration_start TEXT,
  registration_end   TEXT,
  updated_at        TEXT,
  ordinal           INTEGER NOT NULL,   -- 保持后台里的显示顺序
  data              TEXT NOT NULL       -- 完整记录（schedule/track/sources 这些嵌套结构）
);
CREATE INDEX IF NOT EXISTS idx_competitions_status ON competitions(data_status);
CREATE INDEX IF NOT EXISTS idx_competitions_review ON competitions(manual_review);
CREATE INDEX IF NOT EXISTS idx_competitions_event ON competitions(event_id);

-- 后台的纠错工单
CREATE TABLE IF NOT EXISTS feedbacks (
  id       TEXT PRIMARY KEY,
  edition_id TEXT,
  status   TEXT,
  ordinal  INTEGER NOT NULL,
  data     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedbacks_status ON feedbacks(status);

-- AI 任务
CREATE TABLE IF NOT EXISTS ai_jobs (
  id      TEXT PRIMARY KEY,
  status  TEXT,
  ordinal INTEGER NOT NULL,
  data    TEXT NOT NULL
);

-- 整表提交的版本号，用于乐观锁
CREATE TABLE IF NOT EXISTS state_version (
  name       TEXT PRIMARY KEY,
  version    INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  updated_by TEXT
);

-- 已发布赛事：小程序只读这张表
CREATE TABLE IF NOT EXISTS public_cache (
  id                  TEXT PRIMARY KEY,
  event_id            TEXT,
  name                TEXT,
  event_level         TEXT,
  registration_status TEXT,
  sort_weight         INTEGER,
  data                TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_public_cache_status ON public_cache(registration_status);

CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  created_at TEXT,
  action     TEXT,
  record_id  TEXT,
  data       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

-- 用户
CREATE TABLE IF NOT EXISTS user_account (
  id            TEXT PRIMARY KEY,
  openid        TEXT NOT NULL UNIQUE,   -- 唯一约束：并发首次登录只会留下一个账号
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
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  edition_id          TEXT,
  event_type          TEXT,
  remind_at           INTEGER,          -- 时间戳，扫描到期提醒走这个索引
  delivery_status     TEXT,
  authorization_status TEXT,
  data                TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminder_user ON reminder(user_id);
CREATE INDEX IF NOT EXISTS idx_reminder_due ON reminder(remind_at, delivery_status);
CREATE INDEX IF NOT EXISTS idx_reminder_edition ON reminder(edition_id);

-- 用户提交的纠错
CREATE TABLE IF NOT EXISTS feedback_submission (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  edition_id TEXT,
  status     TEXT,
  created_at TEXT,
  data       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback_submission(user_id);

-- 杂项单例文档（AI 运行日志、提醒调用日志），原来塞在 admin_state 里
CREATE TABLE IF NOT EXISTS runtime_doc (
  id   TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
`;
