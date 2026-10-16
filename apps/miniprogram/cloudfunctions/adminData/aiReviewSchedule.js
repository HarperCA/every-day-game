// 微信云开发云函数最长只能跑 60 秒，而单条 Kimi 审核约 50 秒，
// 所以定时任务不能一次扫完全部赛事，只能每次取一小批最久没审核的记录。
const { registrationStatus } = require('./publicCache');

const STALE_DAYS = 7;
const DEFAULT_BATCH_LIMIT = 3;
const FIELD_VERIFICATION_RELEVANT_STATUSES = new Set(['报名中', '即将报名']);

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

// A failed assessment is an actionable queue item even before the weekly review expires.
// A later independent official pass, explicit human review, or completed agent resolution
// supersedes the old assessment and must not launch the same recovery again.
function hasUnresolvedAiReview(record) {
  if (!['needs_changes','insufficient_evidence'].includes(record?.aiReview?.decision)) return false;
  const failedAt = reviewedAtMs(record);
  const afterFailure = value => Number.isFinite(Date.parse(value || '')) && Date.parse(value) >= failedAt;
  // draft：代理跑过、独立复核没全过，已留草稿等人工，不再立刻重跑代理
  if (['published','archived','draft'].includes(record.aiResolution?.outcome) && afterFailure(record.aiResolution.reviewed_at)) return false;
  const verification = record.fieldVerification;
  if (verification?.all_correct === true && verification.source_scope === 'official'
      && !record.needsManualReview && afterFailure(verification.reviewed_at)) return false;
  const actor = String(record.updatedBy || '');
  if (record.manualReview === 'passed' && !record.needsManualReview && actor
      && !/^(system|kimi|ai|scheduled|auto|field|archive)/i.test(actor)
      && afterFailure(record.reviewedAt)) return false;
  return true;
}

function isStale(record, cutoff, now = Date.now()) {
  if (!record || !record.id) return false;
  // 已归档的赛事不会再展示给学生，也不会再改内容，重新审核是白烧模型额度。
  if (record.dataStatus === 'archived' || record.dataStatus === 'quarantined') return false;
  if (now < backoffUntilMs(record) || (hasUnresolvedAiReview(record) && now < fieldVerificationBackoffUntilMs(record))) return false;
  // 代理处理过（含留草稿）也算一次审核，7 天内不再重审
  const resolvedAt = Date.parse(record.aiResolution?.reviewed_at || '');
  const lastReviewedAt = Math.max(reviewedAtMs(record), Number.isFinite(resolvedAt) ? resolvedAt : 0);
  return hasUnresolvedAiReview(record) || lastReviewedAt < cutoff;
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
    .sort((left, right) => Number(hasUnresolvedAiReview(right)) - Number(hasUnresolvedAiReview(left)) || reviewedAtMs(left) - reviewedAtMs(right))
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

// 三项核验用独立的失败计数字段（fieldVerificationFailure），跟通用复核的
// aiReviewFailure 互不干扰——两条审核节奏本来就是分开跑的。
function nextFieldVerificationFailureMark(record, error, now = new Date()) {
  const previous = Number(record && record.fieldVerificationFailure && record.fieldVerificationFailure.count) || 0;
  return { count:previous + 1, lastAt:now.toISOString(), error:String(error || '').slice(0, 300) };
}

// 已发布赛事的"三项核验"（名称/报名时间/链接）跟上面的通用 AI 复核是两条
// 独立的节奏，各自记各自的时间戳和退避计数，互不干扰：一条记录可能通用
// 复核刚跑完、三项核验还没轮到，反之亦然。
function fieldVerifiedAtMs(record) {
  const value = record && record.fieldVerification ? record.fieldVerification.reviewed_at : null;
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function fieldVerificationBackoffUntilMs(record) {
  const failure = record && record.fieldVerificationFailure;
  const count = Number(failure && failure.count) || 0;
  if (count <= 0) return 0;
  const lastAt = failure.lastAt ? Date.parse(failure.lastAt) : NaN;
  if (!Number.isFinite(lastAt)) return 0;
  return lastAt + Math.min(count * BACKOFF_STEP_MS, MAX_BACKOFF_MS);
}

// 范围不是"dataStatus 字面上是不是 published"，是"学生现在能不能报名、
// 人有没有已经认过这条"——像数学建模竞赛那种，人工早通过了，只是系统验证
// 过期重跑失败卡在 pending_manual_review，但当前算出来就是"报名中"，
// 这种照样要进周检，不能因为字面状态不是 published 就漏掉。
// 草稿（从没人看过）不算：那是入库时的三项核验该管的事，不是这里。
// 归档的报名已经关了，不需要再核。
function isStaleForFieldVerification(record, cutoff, now = Date.now()) {
  if (!record || !record.id) return false;
  if (record.manualReview !== 'passed') return false;
  if (record.dataStatus === 'archived' || record.dataStatus === 'draft') return false;
  if (record.dataStatus !== 'published' && !FIELD_VERIFICATION_RELEVANT_STATUSES.has(registrationStatus(record, new Date(now)))) return false;
  if (now < fieldVerificationBackoffUntilMs(record)) return false;
  return fieldVerifiedAtMs(record) < cutoff;
}

function countStaleForFieldVerification(records, { now = Date.now(), staleDays = STALE_DAYS } = {}) {
  const cutoff = staleCutoff(now, staleDays);
  return (Array.isArray(records) ? records : []).filter(record => isStaleForFieldVerification(record, cutoff, now)).length;
}

function selectStaleForFieldVerification(records, { now = Date.now(), staleDays = STALE_DAYS, limit = DEFAULT_BATCH_LIMIT } = {}) {
  const cutoff = staleCutoff(now, staleDays);
  return (Array.isArray(records) ? records : [])
    .filter(record => isStaleForFieldVerification(record, cutoff, now))
    .sort((left, right) => fieldVerifiedAtMs(left) - fieldVerifiedAtMs(right))
    .slice(0, Math.max(0, limit));
}

module.exports = {
  DEFAULT_BATCH_LIMIT, STALE_DAYS, hasUnresolvedAiReview,
  backoffUntilMs, countStaleRecords, nextFailureMark, reviewedAtMs, runStatus, selectStaleRecords,
  fieldVerifiedAtMs, fieldVerificationBackoffUntilMs, nextFieldVerificationFailureMark,
  isStaleForFieldVerification, countStaleForFieldVerification, selectStaleForFieldVerification,
};
