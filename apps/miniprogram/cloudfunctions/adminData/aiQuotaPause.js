// Kimi 会员通道用量上限（每 5 小时一个窗口）时的暂停（2026-10-09 起）。
//
// 定时 AI 审核和字段核验每 5 分钟各跑一次。额度用完后，Kimi 每次都回 403，
// 两个任务原先照样每 5 分钟去撞，白记一堆失败，还给记录加上失败退避标记。
// 现在：碰到额度用完，记下“暂停到什么时候”，期间不再调用 Kimi。官方只说“当前 5 小时窗口结束后重置”，
// 不给具体时间，按用户要求满打满算停 5 小时再继续；到点后若还是用完，再停 5 小时。
const PAUSE_DOC = 'ai_quota_pause';
const PAUSE_MS = 5 * 60 * 60 * 1000;

// Kimi 的原话：“You've reached your 5-hour usage limit…”；联网核对那条路只带回状态码 403
function isQuotaError(error) {
  const text = String(error?.message || error || '');
  return /usage limit|quota will reset|exceed.*quota/i.test(text) || /kimi_resolution_provider_error:403\b/.test(text);
}

function activePause(pause, now = new Date()) {
  const until = Date.parse(pause?.pausedUntil || '');
  return Number.isFinite(until) && until > now.getTime() ? pause : null;
}

function nextPause(reason, now = new Date(), previous = null) {
  return { pausedUntil:new Date(now.getTime() + PAUSE_MS).toISOString(), since:previous?.since || now.toISOString(),
    reason:String(reason || '').slice(0, 200), updatedAt:now.toISOString() };
}

async function readPause(db) {
  try { return (await db.collection('admin_state').doc(PAUSE_DOC).get()).data || null; }
  catch (_error) { return null; }
}

async function writePause(db, pause) {
  try { await db.collection('admin_state').doc(PAUSE_DOC).set({ data:pause }); }
  catch (error) { console.error('ai quota pause write failed', error); }
}

// 额度恢复（这一轮有调用成功）后清掉暂停记录，后台不再显示“暂停中”
async function clearPause(db) {
  try { await db.collection('admin_state').doc(PAUSE_DOC).set({ data:{ pausedUntil:null, clearedAt:new Date().toISOString() } }); }
  catch (_error) { /* 清不掉不影响：过期的暂停本来就不生效 */ }
}

module.exports = { isQuotaError, activePause, nextPause, readPause, writePause, clearPause, PAUSE_MS };
