// 问答记录：替换旧的 conversationLog.js（原来存在云开发的集合 assistant_logs）。规则照旧，只换存放的地方：
// 存进助手自己的库文件（默认 赛事助手/数据/问答记录.db，不进 git；服务器上用 DB_DIR 指到数据目录），和比赛库分开。
//   一轮一条；上下文取这个用户这个会话最近几轮成功的问答；保存半年（180 天），写记录时顺带清理（12 小时最多清一次，一次最多 500 条）。
//
//   打开问答记录(file, { 只读 }) → 记录库 { 存, 取, 全部编号, 最近, 删过期, 按天汇总, 有记录的天数, 时间段内, 关闭 }
//     只读（后台看聊天记录用，2026-11-12）：库文件不存在或还没有表时交回 null，不建文件、不建表
//   saveTurnLog(记录库, entry, now)、loadRecentTurns(记录库, openid, sessionId, limit)、purgeExpiredLogs(记录库, now)   名字和旧的一样
//   按天归档、按人分组的逻辑在 聊天记录.mjs，这里只放读表的语句
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSqlite } from '../../共用/工具/sqlite.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const 默认文件 = () => path.join(process.env.DB_DIR || path.join(HERE, '数据'), '问答记录.db');
const CONTEXT_STATUSES = new Set(['answered', 'empty', 'clarify', 'chat']);
// 保存半年，到期自动删除（2026-10-24，用户定）。隐私说明 services/infoContent.ts 里写的是同一个期限。
export const RETENTION_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;
const PURGE_INTERVAL_MS = 12 * 60 * 60 * 1000;
const PURGE_BATCH = 500;

// created_at 是 UTC 的 ISO 时间（…Z），加 8 小时取日期就是北京时间的哪一天
const 北京日期 = "date(created_at, '+8 hours')";

export function 打开问答记录(file = 默认文件(), { 只读 = false } = {}) {
  if (只读 && (file === ':memory:' || !fs.existsSync(file))) return null;
  if (!只读 && file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = openSqlite(file, 只读 ? { readonly: true, fileMustExist: true } : {});
  if (只读) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'assistant_log'").get()) { db.close(); return null; }
  } else {
    db.exec(`CREATE TABLE IF NOT EXISTS assistant_log (
      id TEXT PRIMARY KEY, openid TEXT, session_id TEXT, created_at TEXT, status TEXT, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS assistant_log_session ON assistant_log(openid, session_id, created_at);
      CREATE INDEX IF NOT EXISTS assistant_log_created ON assistant_log(created_at);`);
  }
  // 只读时用到才准备写入语句（只读库上 run 会报错）
  let 写 = null;
  const 写语句 = () => (写 ||= db.prepare(`INSERT INTO assistant_log (id, openid, session_id, created_at, status, data) VALUES (@id, @openid, @session_id, @created_at, @status, @data)
    ON CONFLICT(id) DO UPDATE SET openid = excluded.openid, session_id = excluded.session_id, created_at = excluded.created_at, status = excluded.status, data = excluded.data`));
  return {
    上次清理: 0,
    存: entry => 写语句().run({ id: entry.id, openid: entry.openid ?? null, session_id: entry.sessionId ?? null, created_at: entry.createdAt ?? null, status: entry.status ?? null, data: JSON.stringify(entry) }),
    取: id => { const row = db.prepare('SELECT data FROM assistant_log WHERE id = ?').get(id); return row ? JSON.parse(row.data) : null; },
    全部编号: () => db.prepare('SELECT id FROM assistant_log ORDER BY id').all().map(r => r.id),
    最近: (openid, sessionId, n) => db.prepare('SELECT data FROM assistant_log WHERE openid = ? AND session_id = ? ORDER BY created_at DESC LIMIT ?').all(openid, sessionId, n).map(r => JSON.parse(r.data)),
    删过期: (cutoff, n) => db.prepare('DELETE FROM assistant_log WHERE id IN (SELECT id FROM assistant_log WHERE created_at <= ? LIMIT ?)').run(cutoff, n).changes,
    // 看聊天记录用（聊天记录.mjs）：每个北京日期几个人、几轮，新的日子在前；有记录的一共几天；
    // 一段时间里每轮的 openid、时间、用户输入、这一轮的结果（status）、给用户的回答（reply）、回答被换成固定句子的原因有几条（replyViolations）。
    // 只取这几样，模型原始输出、工具调用等别的字段不取（2026-11-12 起要看回答）
    按天汇总: (限, 跳过) => db.prepare(`SELECT ${北京日期} AS 日期, COUNT(DISTINCT openid) AS 人数, COUNT(*) AS 条数 FROM assistant_log
      WHERE ${北京日期} IS NOT NULL GROUP BY 日期 ORDER BY 日期 DESC LIMIT ? OFFSET ?`).all(限, 跳过),
    有记录的天数: () => db.prepare(`SELECT COUNT(DISTINCT ${北京日期}) AS n FROM assistant_log`).get().n,
    时间段内: (从, 到) => db.prepare(`SELECT openid, created_at, status, json_extract(data, '$.message') AS message, json_extract(data, '$.reply') AS reply,
      json_array_length(data, '$.replyViolations') AS 违规数 FROM assistant_log
      WHERE created_at >= ? AND created_at < ? ORDER BY created_at, id`).all(从, 到),
    关闭: () => db.close(),
  };
}

// 删掉保存满半年的记录（createdAt 是 ISO 时间字符串，按字符串比较即按时间先后）
export async function purgeExpiredLogs(记录库, now = new Date()) {
  return 记录库.删过期(new Date(now.getTime() - RETENTION_DAYS * DAY_MS).toISOString(), PURGE_BATCH);
}

export async function saveTurnLog(记录库, entry, now = new Date()) {
  记录库.存(entry);
  if (now.getTime() - 记录库.上次清理 < PURGE_INTERVAL_MS) return;
  记录库.上次清理 = now.getTime();
  // 清理失败不影响这一轮回答，下次再试
  try { await purgeExpiredLogs(记录库, now); } catch (_error) { 记录库.上次清理 = 0; }
}

// 这个用户、这个会话里最近几轮成功的问答，按时间从早到晚返回
export async function loadRecentTurns(记录库, openid, sessionId, limit = 6) {
  return 记录库.最近(openid, sessionId, limit * 2)
    .filter(turn => CONTEXT_STATUSES.has(turn.status) && turn.reply)
    .slice(0, limit).reverse().map(turn => ({ id: turn.id, message: turn.message, reply: turn.reply }));
}
