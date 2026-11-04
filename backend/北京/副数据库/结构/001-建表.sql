-- 由 结构/生成.mjs 按 描述/ 生成，不要手改。上线后改表一律新增编号文件。

-- 小程序账号
CREATE TABLE user_account (
  id TEXT PRIMARY KEY,
  openid TEXT NOT NULL,
  appid TEXT,
  unionid TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  last_login_at TEXT,
  UNIQUE (openid)
);

-- 收藏
CREATE TABLE favorite (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_account(id) DEFERRABLE INITIALLY DEFERRED,
  competition_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, competition_id)
);
CREATE INDEX idx_favorite_user_id ON favorite(user_id);

-- 提醒
CREATE TABLE reminder (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_account(id) DEFERRABLE INITIALLY DEFERRED,
  edition_id TEXT NOT NULL,
  competition_name TEXT NOT NULL,
  task_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_label TEXT NOT NULL,
  target_at TEXT NOT NULL,
  advance_key TEXT NOT NULL,
  advance_label TEXT NOT NULL,
  offset_ms INTEGER NOT NULL,
  remind_at TEXT NOT NULL,
  authorization_status TEXT NOT NULL,
  delivery_status TEXT NOT NULL,
  schedule_change_status TEXT NOT NULL,
  subscription_template_id TEXT,
  retry_count INTEGER NOT NULL,
  last_error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_reminder_user_id ON reminder(user_id);
CREATE INDEX idx_reminder_remind_at_delivery_status ON reminder(remind_at, delivery_status);
CREATE INDEX idx_reminder_edition_id ON reminder(edition_id);

-- 意见反馈
CREATE TABLE general_feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_account(id) DEFERRABLE INITIALLY DEFERRED,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  contact TEXT,
  app_version TEXT,
  status TEXT NOT NULL,
  public_reply TEXT,
  internal_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX idx_general_feedback_user_id ON general_feedback(user_id);
CREATE INDEX idx_general_feedback_status ON general_feedback(status);

-- 纠错
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_account(id) DEFERRABLE INITIALLY DEFERRED,
  edition_id TEXT NOT NULL,
  competition_name TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  evidence_url TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX idx_feedback_user_id ON feedback(user_id);
CREATE INDEX idx_feedback_status ON feedback(status);
CREATE INDEX idx_feedback_edition_id ON feedback(edition_id);

-- 偏好
CREATE TABLE user_preference (
  user_id TEXT PRIMARY KEY REFERENCES user_account(id) DEFERRABLE INITIALLY DEFERRED,
  profession TEXT,
  categories TEXT,
  province TEXT,
  survey_status TEXT NOT NULL,
  dont_show_again INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
