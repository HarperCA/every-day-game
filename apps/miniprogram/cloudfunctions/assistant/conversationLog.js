// 对话记录：一轮一条，集合 assistant_logs。上下文也从这里取（不另建会话集合）。
const COLLECTION = 'assistant_logs';
const CONTEXT_STATUSES = new Set(['answered', 'empty', 'clarify', 'chat']);

async function saveTurnLog(db, entry) {
  await db.collection(COLLECTION).doc(entry.id).set({ data:entry });
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

module.exports = { saveTurnLog, loadRecentTurns, COLLECTION };
