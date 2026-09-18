// 原生数据访问层。handler 直接用这些函数，不再经过 CloudBase 兼容外壳。
//
// 一条纪律：这一层只管存取，不含业务判断。发布闸、收录门槛、认可度评分
// 这些仍然在原来的模块里（publicCache / competitionValue / ...），
// 迁移不改业务语义。
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA } from './schema.mjs';

export function openStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

const parse = row => (row ? JSON.parse(row.data) : null);
const parseAll = rows => rows.map(row => JSON.parse(row.data));

// —— 整表提交的三张表：competitions / feedbacks / ai_jobs ——

const STATE_TABLES = {
  competitions: {
    table: 'competitions',
    columns: '(id, event_id, name, data_status, system_validation, manual_review, event_level, registration_start, registration_end, updated_at, ordinal, data)',
    placeholders: '(@id, @event_id, @name, @data_status, @system_validation, @manual_review, @event_level, @registration_start, @registration_end, @updated_at, @ordinal, @data)',
    toRow: (record, ordinal) => ({
      id: String(record.id),
      event_id: String(record.eventId || ''),
      name: String(record.name || ''),
      data_status: String(record.dataStatus || ''),
      system_validation: String(record.systemValidation || ''),
      manual_review: String(record.manualReview || ''),
      event_level: record.eventLevel ?? null,
      registration_start: record.schedule?.registration_start ?? null,
      registration_end: record.schedule?.registration_end ?? null,
      updated_at: record.updatedAt ?? null,
      ordinal,
      data: JSON.stringify(record),
    }),
  },
  feedbacks: {
    table: 'feedbacks',
    columns: '(id, edition_id, status, ordinal, data)',
    placeholders: '(@id, @edition_id, @status, @ordinal, @data)',
    toRow: (record, ordinal) => ({
      id: String(record.id),
      edition_id: record.editionId ?? record.edition_id ?? null,
      status: record.status ?? null,
      ordinal,
      data: JSON.stringify(record),
    }),
  },
  ai_jobs: {
    table: 'ai_jobs',
    columns: '(id, status, ordinal, data)',
    placeholders: '(@id, @status, @ordinal, @data)',
    toRow: (record, ordinal) => ({
      id: String(record.id),
      status: record.status ?? null,
      ordinal,
      data: JSON.stringify(record),
    }),
  },
};

export function readStateRecords(db, name) {
  const spec = STATE_TABLES[name];
  if (!spec) throw new Error(`unknown_state_table:${name}`);
  return parseAll(db.prepare(`SELECT data FROM ${spec.table} ORDER BY ordinal ASC`).all());
}

export function readStateVersion(db, name) {
  const row = db.prepare('SELECT version FROM state_version WHERE name = ?').get(name);
  return row ? row.version : 0;
}

// 整表替换 + 版本号自增。调用方负责先校验 expectedVersion（见 stateVersion.js），
// 这里只管把「要么全换、要么不动」这件事做到。
export function replaceStateRecords(db, name, records, version, updatedBy = 'super_admin') {
  const spec = STATE_TABLES[name];
  if (!spec) throw new Error(`unknown_state_table:${name}`);
  db.prepare(`DELETE FROM ${spec.table}`).run();
  const insert = db.prepare(`INSERT INTO ${spec.table} ${spec.columns} VALUES ${spec.placeholders}`);
  records.forEach((record, index) => insert.run(spec.toRow(record, index)));
  db.prepare(`
    INSERT INTO state_version (name, version, updated_at, updated_by) VALUES (@name, @version, @updated_at, @updated_by)
    ON CONFLICT(name) DO UPDATE SET version = @version, updated_at = @updated_at, updated_by = @updated_by
  `).run({ name, version, updated_at: new Date().toISOString(), updated_by: updatedBy });
}

// —— 公开缓存 ——

export function listPublicCache(db) {
  return parseAll(db.prepare('SELECT data FROM public_cache').all());
}

export function getPublicCache(db, id) {
  return parse(db.prepare('SELECT data FROM public_cache WHERE id = ?').get(id));
}

export function putPublicCache(db, entry) {
  db.prepare(`
    INSERT INTO public_cache (id, event_id, name, event_level, registration_status, sort_weight, data)
    VALUES (@id, @event_id, @name, @event_level, @registration_status, @sort_weight, @data)
    ON CONFLICT(id) DO UPDATE SET
      event_id = @event_id, name = @name, event_level = @event_level,
      registration_status = @registration_status, sort_weight = @sort_weight, data = @data
  `).run({
    id: String(entry.id),
    event_id: entry.event_id ?? null,
    name: entry.name ?? null,
    event_level: entry.event_level ?? null,
    registration_status: entry.registration_status ?? null,
    sort_weight: Number.isFinite(entry.sort_weight) ? entry.sort_weight : null,
    data: JSON.stringify(entry),
  });
}

export function removePublicCache(db, id) {
  return db.prepare('DELETE FROM public_cache WHERE id = ?').run(id).changes;
}

// —— 审计 ——

export function appendAudit(db, entry) {
  db.prepare(`
    INSERT INTO audit_log (id, created_at, action, record_id, data) VALUES (@id, @created_at, @action, @record_id, @data)
    ON CONFLICT(id) DO UPDATE SET created_at = @created_at, action = @action, record_id = @record_id, data = @data
  `).run({
    id: String(entry.id),
    created_at: entry.createdAt ?? entry.created_at ?? null,
    action: entry.action ?? null,
    record_id: entry.recordId ?? entry.record_id ?? null,
    data: JSON.stringify(entry),
  });
}

export function listAudit(db, limit = 100) {
  return parseAll(db.prepare('SELECT data FROM audit_log ORDER BY created_at DESC LIMIT ?').all(limit));
}

// —— 用户 ——

export function findUserByOpenid(db, openid) {
  const row = db.prepare('SELECT * FROM user_account WHERE openid = ?').get(openid);
  return row || null;
}

export function insertUser(db, user) {
  db.prepare(`
    INSERT INTO user_account (id, openid, appid, unionid, status, created_at, updated_at, last_login_at)
    VALUES (@id, @openid, @appid, @unionid, @status, @created_at, @updated_at, @last_login_at)
  `).run(user);
}

export function touchUserLogin(db, id, patch) {
  db.prepare('UPDATE user_account SET appid = @appid, unionid = @unionid, last_login_at = @last_login_at, updated_at = @updated_at WHERE id = @id')
    .run({ id, ...patch });
}

// —— 收藏 ——

export function listFavorites(db, userId) {
  return parseAll(db.prepare('SELECT data FROM favorite WHERE user_id = ?').all(userId));
}

export function putFavorite(db, entry) {
  db.prepare(`
    INSERT INTO favorite (id, user_id, edition_id, data) VALUES (@id, @user_id, @edition_id, @data)
    ON CONFLICT(user_id, edition_id) DO UPDATE SET data = @data
  `).run({
    id: String(entry.id), user_id: String(entry.user_id), edition_id: String(entry.edition_id), data: JSON.stringify(entry),
  });
}

export function removeFavorite(db, userId, editionId) {
  return db.prepare('DELETE FROM favorite WHERE user_id = ? AND edition_id = ?').run(userId, editionId).changes;
}

// —— 提醒 ——

const reminderRow = entry => ({
  id: String(entry.id),
  user_id: String(entry.user_id),
  edition_id: entry.edition_id ?? null,
  event_type: entry.event_type ?? null,
  remind_at: Number.isFinite(Number(entry.remind_at)) ? Number(entry.remind_at) : null,
  delivery_status: entry.delivery_status ?? null,
  authorization_status: entry.authorization_status ?? null,
  data: JSON.stringify(entry),
});

export function listReminders(db, userId) {
  return parseAll(db.prepare('SELECT data FROM reminder WHERE user_id = ?').all(userId));
}

export function putReminder(db, entry) {
  db.prepare(`
    INSERT INTO reminder (id, user_id, edition_id, event_type, remind_at, delivery_status, authorization_status, data)
    VALUES (@id, @user_id, @edition_id, @event_type, @remind_at, @delivery_status, @authorization_status, @data)
    ON CONFLICT(id) DO UPDATE SET
      user_id = @user_id, edition_id = @edition_id, event_type = @event_type, remind_at = @remind_at,
      delivery_status = @delivery_status, authorization_status = @authorization_status, data = @data
  `).run(reminderRow(entry));
}

export function removeReminder(db, id) {
  return db.prepare('DELETE FROM reminder WHERE id = ?').run(id).changes;
}

export function removeRemindersForEdition(db, userId, editionId) {
  return db.prepare('DELETE FROM reminder WHERE user_id = ? AND edition_id = ?').run(userId, editionId).changes;
}

// 扫描到期待发的提醒——走 (remind_at, delivery_status) 索引，
// 不再像文档模型那样把整表拉出来在 JS 里过一遍。
export function listDueReminders(db, nowMs, limit = 50) {
  return parseAll(db.prepare(`
    SELECT data FROM reminder
    WHERE remind_at IS NOT NULL AND remind_at <= ? AND delivery_status = 'pending'
    ORDER BY remind_at ASC LIMIT ?
  `).all(nowMs, limit));
}

// —— 用户提交的纠错 ——

export function listFeedbackSubmissions(db, userId = null) {
  const rows = userId
    ? db.prepare('SELECT data FROM feedback_submission WHERE user_id = ? ORDER BY created_at DESC').all(userId)
    : db.prepare('SELECT data FROM feedback_submission ORDER BY created_at DESC').all();
  return parseAll(rows);
}

export function putFeedbackSubmission(db, entry) {
  db.prepare(`
    INSERT INTO feedback_submission (id, user_id, edition_id, status, created_at, data)
    VALUES (@id, @user_id, @edition_id, @status, @created_at, @data)
    ON CONFLICT(id) DO UPDATE SET status = @status, data = @data
  `).run({
    id: String(entry.id),
    user_id: entry.user_id ?? null,
    edition_id: entry.edition_id ?? null,
    status: entry.status ?? null,
    created_at: entry.created_at ?? null,
    data: JSON.stringify(entry),
  });
}

// —— 杂项单例文档 ——

export function readRuntimeDoc(db, id) {
  return parse(db.prepare('SELECT data FROM runtime_doc WHERE id = ?').get(id));
}

export function writeRuntimeDoc(db, id, data) {
  db.prepare('INSERT INTO runtime_doc (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data')
    .run(id, JSON.stringify(data));
}

export function summarize(db) {
  const count = table => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  return {
    competitions: count('competitions'),
    feedbacks: count('feedbacks'),
    ai_jobs: count('ai_jobs'),
    public_cache: count('public_cache'),
    audit_log: count('audit_log'),
    user_account: count('user_account'),
    favorite: count('favorite'),
    reminder: count('reminder'),
    feedback_submission: count('feedback_submission'),
  };
}
