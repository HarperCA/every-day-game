// 对话记录：一轮一条，集合 assistant_logs。上下文也从这里取（不另建会话集合）。
const COLLECTION = 'assistant_logs';
const CONTEXT_STATUSES = new Set(['answered', 'empty', 'clarify', 'chat']);
// 保存半年，到期自动删除（2026-10-24，用户定）。隐私说明 services/infoContent.ts 里写的是同一个期限。
const RETENTION_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;
// 写记录时顺带清理：每个进程每 12 小时最多清一次，一次最多删 500 条，删不完下次接着删
const PURGE_INTERVAL_MS = 12 * 60 * 60 * 1000;
const PURGE_BATCH = 500;
let lastPurgeAt = 0;

// 删掉保存满半年的记录（createdAt 是 ISO 时间字符串，按字符串比较即按时间先后）
async function purgeExpiredLogs(db, now = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * DAY_MS).toISOString();
  let rows;
  try {
    rows = (await db.collection(COLLECTION).where({ createdAt:db.command.lte(cutoff) }).limit(PURGE_BATCH).get()).data || [];
  } catch (error) {
    if (/not exist|not found|-502005/i.test(String(error?.errCode || '') + String(error?.message || ''))) return 0;
    throw error;
  }
  for (const row of rows) await db.collection(COLLECTION).doc(row._id || row.id).remove();
  return rows.length;
}

async function saveTurnLog(db, entry, now = new Date()) {
  await db.collection(COLLECTION).doc(entry.id).set({ data:entry });
  if (now.getTime() - lastPurgeAt < PURGE_INTERVAL_MS) return;
  lastPurgeAt = now.getTime();
  // 清理失败不影响这一轮回答，下次再试
  try { await purgeExpiredLogs(db, now); } catch (_error) { lastPurgeAt = 0; }
}

// 这个用户、这个会话里最近几轮成功的问答，按时间从早到晚返回
async function loadRecentTurns(db, openid, sessionId, limit = 6) {
  try {
    const result = await db.collection(COLLECTION).where({ openid, sessionId }).orderBy('createdAt', 'desc').limit(limit * 2).get();
    return (result.data || [])
      .filter(turn => CONTEXT_STATUSES.has(turn.status) && turn.reply)
      .slice(0, limit).reverse().map(turn => ({ id:turn.id, message:turn.message, reply:turn.reply }));
  } catch (error) {
    // 集合还没建 = 还没有任何记录
    if (/not exist|not found|-502005/i.test(String(error?.errCode || '') + String(error?.message || ''))) return [];
    throw error;
  }
}

module.exports = { saveTurnLog, loadRecentTurns, purgeExpiredLogs, COLLECTION, RETENTION_DAYS };
