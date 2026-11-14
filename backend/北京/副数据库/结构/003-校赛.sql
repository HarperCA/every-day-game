-- 由 结构/生成.mjs 按 描述/ 生成，不要手改。上线后改表一律新增编号文件。

-- 校赛管理员申请
CREATE TABLE school_admin (
  id TEXT PRIMARY KEY,
  user TEXT NOT NULL REFERENCES user_account(id) DEFERRABLE INITIALLY DEFERRED,
  school TEXT NOT NULL,
  real_name TEXT NOT NULL,
  contact TEXT NOT NULL,
  proof TEXT NOT NULL,
  status TEXT NOT NULL,
  review_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX idx_school_admin_user ON school_admin(user);
CREATE INDEX idx_school_admin_school_status ON school_admin(school, status);

-- 校赛学生
CREATE TABLE school_member (
  id TEXT PRIMARY KEY,
  school TEXT NOT NULL,
  user TEXT NOT NULL REFERENCES user_account(id) DEFERRABLE INITIALLY DEFERRED,
  real_name TEXT NOT NULL,
  college TEXT NOT NULL,
  major TEXT NOT NULL,
  student_no TEXT NOT NULL,
  invite_code TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  UNIQUE (school, user)
);
CREATE INDEX idx_school_member_user ON school_member(user);

-- 校赛邀请
CREATE TABLE school_invite (
  id TEXT PRIMARY KEY,
  school TEXT NOT NULL,
  admin TEXT NOT NULL REFERENCES user_account(id) DEFERRABLE INITIALLY DEFERRED,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX idx_school_invite_school ON school_invite(school);

-- 校赛
CREATE TABLE school_contest (
  id TEXT PRIMARY KEY,
  school TEXT NOT NULL,
  admin TEXT NOT NULL REFERENCES user_account(id) DEFERRABLE INITIALLY DEFERRED,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  signup TEXT,
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL,
  review_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX idx_school_contest_school_status ON school_contest(school, status);
CREATE INDEX idx_school_contest_admin ON school_contest(admin);
