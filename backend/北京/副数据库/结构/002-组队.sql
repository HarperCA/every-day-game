-- 由 结构/生成.mjs 按 描述/ 生成，不要手改。上线后改表一律新增编号文件。

-- 队伍
CREATE TABLE team (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user_account(id) DEFERRABLE INITIALLY DEFERRED,
  max_members INTEGER NOT NULL,
  leader_wechat TEXT,
  name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX idx_team_user_id ON team(user_id);
CREATE INDEX idx_team_competition_id ON team(competition_id);

-- 队员
CREATE TABLE team_member (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES team(id) DEFERRABLE INITIALLY DEFERRED,
  user_id TEXT NOT NULL REFERENCES user_account(id) DEFERRABLE INITIALLY DEFERRED,
  role TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  UNIQUE (team_id, user_id)
);
CREATE INDEX idx_team_member_user_id ON team_member(user_id);

-- 组队申请
CREATE TABLE team_application (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES team(id) DEFERRABLE INITIALLY DEFERRED,
  user_id TEXT NOT NULL REFERENCES user_account(id) DEFERRABLE INITIALLY DEFERRED,
  major TEXT NOT NULL,
  grade TEXT NOT NULL,
  intro TEXT,
  strengths TEXT,
  status TEXT NOT NULL,
  handled_by TEXT,
  handled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_team_application_team_id_status ON team_application(team_id, status);
CREATE INDEX idx_team_application_user_id ON team_application(user_id);

-- 组队通知次数
CREATE TABLE team_notify_quota (
  user_id TEXT PRIMARY KEY REFERENCES user_account(id) DEFERRABLE INITIALLY DEFERRED,
  apply_quota INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
