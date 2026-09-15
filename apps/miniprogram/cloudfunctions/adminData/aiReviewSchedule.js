// 微信云开发云函数最长只能跑 60 秒，而单条 Kimi 审核约 50 秒，
// 所以定时任务不能一次扫完全部赛事，只能每次取一小批最久没审核的记录。
const STALE_DAYS = 7;
const DEFAULT_BATCH_LIMIT = 3;

function reviewedAtMs(record) {
  const value = record && record.aiReview ? record.aiReview.reviewed_at : null;
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0; // 从未审核过的排最前
}

// 连续失败的记录要退避，否则一条永远跑不完的赛事会每次触发都重试，白烧模型额度。
const BACKOFF_STEP_MS = 6 * 60 * 60 * 1000;
const MAX_BACKOFF_MS = 7 * 24 * 60 * 60 * 1000;

function backoffUntilMs(record) {
  const failure = record && record.aiReviewFailure;
  const count = Number(failure && failure.count) || 0;
  if (count <= 0) return 0;
  const lastAt = failure.lastAt ? Date.parse(failure.lastAt) : NaN;
  if (!Number.isFinite(lastAt)) return 0;
  return lastAt + Math.min(count * BACKOFF_STEP_MS, MAX_BACKOFF_MS);
}

function isStale(record, cutoff, now = Date.now()) {
  if (!record || !record.id) return false;
  if (now < backoffUntilMs(record)) return false;
  return reviewedAtMs(record) < cutoff;
}

function staleCutoff(now, staleDays) {
  return now - staleDays * 24 * 60 * 60 * 1000;
}

function countStaleRecords(records, { now = Date.now(), staleDays = STALE_DAYS } = {}) {
  const cutoff = staleCutoff(now, staleDays);
  return (Array.isArray(records) ? records : []).filter(record => isStale(record, cutoff, now)).length;
}

function selectStaleRecords(records, { now = Date.now(), staleDays = STALE_DAYS, limit = DEFAULT_BATCH_LIMIT } = {}) {
  const cutoff = staleCutoff(now, staleDays);
  return (Array.isArray(records) ? records : [])
    .filter(record => isStale(record, cutoff, now))
    .sort((left, right) => reviewedAtMs(left) - reviewedAtMs(right))
    .slice(0, Math.max(0, limit));
}

// idle 表示这一轮没有到期记录，属于正常空跑，不是故障。
function runStatus({ selected = 0, succeeded = 0, failed = 0, remaining = 0, errored = false } = {}) {
  if (errored) return 'failed';
  if (!selected) return 'idle';
  if (failed && !succeeded) return 'failed';
  return remaining > 0 ? 'partial' : 'completed';
}

// 失败计数累加，成功时由调用方清除该字段。
function nextFailureMark(record, error, now = new Date()) {
  const previous = Number(record && record.aiReviewFailure && record.aiReviewFailure.count) || 0;
  return { count:previous + 1, lastAt:now.toISOString(), error:String(error || '').slice(0, 300) };
}

module.exports = {
  DEFAULT_BATCH_LIMIT, STALE_DAYS,
  backoffUntilMs, countStaleRecords, nextFailureMark, reviewedAtMs, runStatus, selectStaleRecords,
};
