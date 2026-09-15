const cloud = require('wx-server-sdk');
const { issueAdminSession, requireStaticAdminToken, verifyAdminSession } = require('./adminAuth');
const { nextStateVersion, normalizeStateVersion } = require('./stateVersion');
const { canonicalFeedbackDocumentId, mergeFeedbackRecords } = require('./feedbackMerge');
const { buildSafeAuditEntry } = require('./auditValidation');
const { syncPublicCache } = require('./publicCache');
const { aiReviewConfigStatus, runCompetitionAiReview } = require('./competitionAiReview');
const { countStaleRecords, nextFailureMark, runStatus, selectStaleRecords } = require('./aiReviewSchedule');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const MAX_RECORDS = 100;
const MAX_FEEDBACKS = 1000;
const MAX_AI_JOBS = 1000;
// 实测：单条审核约 50 秒，且 Kimi 端并发请求是排队的，3 条并发只会让后两条超时。
// 所以定时任务每次只处理 1 条。模型超时按剩余预算动态计算（见 runScheduledCompetitionAiReview），
// 因为取证耗时不可预测；超限会被平台直接掐断，连失败记录都写不下。
const SCHEDULED_BATCH_LIMIT = 1;
const SCHEDULED_CHAT_TIMEOUT_MS = 40000;
// 整次调用的自设预算，必须明显小于平台 60 秒硬上限。
const SCHEDULED_BUDGET_MS = 47000;
const SCHEDULED_SAVE_RESERVE_MS = 9000;
const SCHEDULED_MIN_CHAT_TIMEOUT_MS = 15000;
const SCHEDULED_MAX_TOKENS = 2000;
const MANUAL_CHAT_TIMEOUT_MS = 50000;
const MANUAL_MAX_TOKENS = 2600;
const AI_RUN_LOG_DOC = 'ai_review_runs';
const MAX_AI_RUN_LOG = 20;

function requireAdmin(event) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) throw new Error('admin_token_not_configured');
  if (verifyAdminSession(event.sessionToken, expected)) return;
  requireStaticAdminToken(event.adminToken, expected);
}

function requireRecords(value, max, field) {
  if (!Array.isArray(value)) throw new Error(`invalid_${field}`);
  if (value.length > max) throw new Error(`${field}_limit_exceeded`);
  return value;
}

async function loadState(id) {
  try {
    const result = await db.collection('admin_state').doc(id).get();
    return {
      records:Array.isArray(result.data?.records) ? result.data.records : [],
      version:normalizeStateVersion(result.data?.version),
    };
  } catch (error) {
    if (error?.errCode === -1 || /not exist|not found/i.test(error?.message || '')) return { records:[], version:0 };
    throw error;
  }
}

async function saveState(id, records, expectedVersion, transactionWork, auditEntry) {
  const safeAuditEntry = auditEntry ? buildSafeAuditEntry(auditEntry) : null;
  return db.runTransaction(async transaction => {
    let current = { version:0 };
    try {
      const result = await transaction.collection('admin_state').doc(id).get();
      current = result.data || current;
    } catch (error) {
      if (!(error?.errCode === -1 || /not exist|not found/i.test(error?.message || ''))) throw error;
    }
    const version = nextStateVersion(id, current.version, expectedVersion);
    const extra = transactionWork ? await transactionWork(transaction, current) : {};
    await transaction.collection('admin_state').doc(id).set({ data: {
      records,
      version,
      updated_at: new Date().toISOString(),
      updated_by: 'super_admin',
    } });
    if (safeAuditEntry) await transaction.collection('audit_log').doc(safeAuditEntry.id).set({ data:safeAuditEntry });
    return { saved:records.length, version, optimisticLockApplied:true, auditSaved:Boolean(safeAuditEntry), ...extra };
  });
}

function feedbackToAdmin(item) {
  const userId = String(item.user_id || '');
  return {
    id:item.id || item._id,
    editionId:item.edition_id,
    competitionName:item.competition_name || item.edition_id || '未知赛事',
    category:item.category,
    content:item.content,
    evidenceUrl:item.evidence_url || '',
    submitterMasked:userId ? `用户***${userId.slice(-4)}` : '用户***',
    status:item.status || 'pending_ai_review',
    aiDecision:item.ai_decision || undefined,
    aiRiskLevel:item.ai_risk_level || undefined,
    aiConclusion:item.ai_conclusion || undefined,
    aiEvidenceSummary:item.ai_evidence_summary || undefined,
    aiReviewedAt:item.ai_reviewed_at || undefined,
    aiJobId:item.ai_job_id || undefined,
    spotCheckStatus:item.spot_check_status || 'not_checked',
    spotCheckedAt:item.spot_checked_at || undefined,
    reviewer:item.reviewer_id || undefined,
    reviewNote:item.review_note || undefined,
    resolvedAt:item.resolved_at || undefined,
    createdAt:item.created_at,
    source:'user_submission',
    cloudDocumentId:item._id || item.id,
  };
}

const FEEDBACK_STATUSES = new Set(['pending_ai_review', 'ai_queued', 'ai_passed', 'ai_flagged', 'human_reviewing', 'accepted', 'rejected']);
const FEEDBACK_CATEGORIES = new Set(['time', 'registration_link', 'eligibility', 'rules', 'other']);

function feedbackReviewUpdate(item, now) {
  if (!FEEDBACK_STATUSES.has(item.status)) throw new Error('invalid_feedback_status');
  if (!FEEDBACK_CATEGORIES.has(item.category)) throw new Error('invalid_feedback_category');
  const content = String(item.content || '').trim();
  if (content.length < 5 || content.length > 2000) throw new Error('invalid_feedback_content');
  const evidenceUrl = String(item.evidenceUrl || '').trim();
  if (evidenceUrl && (!/^https?:\/\//i.test(evidenceUrl) || evidenceUrl.length > 2048)) throw new Error('invalid_feedback_evidence_url');
  return {
    competition_name:String(item.competitionName || '').trim().slice(0, 200),
    category:item.category,
    content,
    evidence_url:evidenceUrl || null,
    status:item.status,
    ai_decision:item.aiDecision || null,
    ai_risk_level:item.aiRiskLevel || null,
    ai_conclusion:item.aiConclusion || null,
    ai_evidence_summary:item.aiEvidenceSummary || null,
    ai_reviewed_at:item.aiReviewedAt || null,
    ai_job_id:item.aiJobId || null,
    spot_check_status:item.spotCheckStatus || 'not_checked',
    spot_checked_at:item.spotCheckedAt || null,
    reviewer_id:item.reviewer ? 'super_admin' : null,
    review_note:item.reviewNote || null,
    resolved_at:item.resolvedAt || null,
    updated_at:now,
  };
}

async function syncSubmittedFeedbacks(records, database = db) {
  const submitted = records.filter(item => item?.source === 'user_submission');
  const now = new Date().toISOString();
  await Promise.all(submitted.map(async item => {
    const documentId = canonicalFeedbackDocumentId(item);
    await database.collection('feedback').doc(documentId).update({ data:feedbackReviewUpdate(item, now) });
  }));
  return submitted.length;
}

async function loadSubmittedFeedbacks() {
  try {
    const result = await db.collection('feedback').orderBy('created_at', 'desc').limit(MAX_FEEDBACKS).get();
    return (result.data || []).map(feedbackToAdmin);
  } catch (error) {
    if (error?.errCode === -1 || /not exist|not found/i.test(error?.message || '')) return [];
    throw error;
  }
}

function auditToAdmin(item) {
  const before = item.before || {};
  const after = item.after || {};
  const fieldNames = item.changed_fields || item.changedFields || Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  const changes = Object.fromEntries(fieldNames.map(field => [field, { before:before[field], after:after[field] }]));
  return {
    id:item.id || item._id,
    action:item.action,
    objectType:item.object_type || item.objectType,
    recordId:item.object_id || item.recordId,
    recordName:item.record_name || item.recordName || item.object_id || item.recordId,
    changedFields:fieldNames,
    createdAt:item.created_at || item.createdAt,
    actor:item.actor_id || item.actor || 'super_admin',
    reason:item.reason || undefined,
    changes,
  };
}

async function bootstrap() {
  const [competitionState, feedbackState, submittedFeedbacks, aiJobState, auditResult, lastAiReviewRun] = await Promise.all([
    loadState('competitions'),
    loadState('feedbacks'),
    loadSubmittedFeedbacks(),
    loadState('ai_jobs'),
    db.collection('audit_log').orderBy('created_at', 'desc').limit(100).get(),
    loadLastAiReviewRun(),
  ]);
  const feedbacks = mergeFeedbackRecords(feedbackState.records, submittedFeedbacks, MAX_FEEDBACKS);
  return {
    records:competitionState.records,
    feedbacks,
    aiJobs:aiJobState.records,
    audits:(auditResult.data || []).map(auditToAdmin),
    lastAiReviewRun,
    stateVersions:{ records:competitionState.version, feedbacks:feedbackState.version, aiJobs:aiJobState.version },
  };
}

async function runAiReviewPool(records, concurrency = 5, options = {}) {
  const results = new Map();
  const failures = [];
  let cursor = 0;
  async function worker() {
    while (cursor < records.length) {
      const record = records[cursor++];
      try {
        results.set(record.id, await runCompetitionAiReview(record, undefined, options));
      } catch (error) {
        failures.push({ recordId:record.id, recordName:record.name, error:String(error?.message || error).slice(0, 500) });
      }
    }
  }
  await Promise.all(Array.from({ length:Math.min(concurrency, records.length) }, () => worker()));
  return { results, failures };
}

function scheduledBatchLimit() {
  const configured = Number(process.env.AI_REVIEW_CONCURRENCY || SCHEDULED_BATCH_LIMIT);
  return Number.isInteger(configured) ? Math.min(10, Math.max(1, configured)) : SCHEDULED_BATCH_LIMIT;
}

// 一次调用只跑一批并发请求：证据抓取最多 8 秒、模型调用最多 40 秒，
// 加上读写状态仍在 60 秒硬上限内。跑不完的记录留给下一次定时触发。
async function runScheduledCompetitionAiReview(trigger = 'timer') {
  const startedMs = Date.now();
  const startedAt = new Date().toISOString();
  const summary = {
    trigger, startedAt, completedAt:startedAt,
    selected:0, succeeded:0, failed:0, remaining:0,
    status:'failed', failures:[],
  };
  try {
    const state = await loadState('competitions');
    const limit = scheduledBatchLimit();
    const due = selectStaleRecords(state.records, { limit });
    summary.selected = due.length;
    if (due.length) {
      // 云函数 60 秒是硬上限，超限会被直接掐断、连失败记录都写不下。
      // 取证耗时不可预测，所以按“已用掉多少”动态压缩模型调用的超时，
      // 并为写回状态和运行日志留出固定余量。
      const elapsed = Date.now() - startedMs;
      const chatTimeoutMs = Math.max(
        SCHEDULED_MIN_CHAT_TIMEOUT_MS,
        Math.min(SCHEDULED_CHAT_TIMEOUT_MS, SCHEDULED_BUDGET_MS - elapsed - SCHEDULED_SAVE_RESERVE_MS),
      );
      summary.chatTimeoutMs = chatTimeoutMs;
      const { results, failures } = await runAiReviewPool(due, due.length, {
        chatTimeoutMs,
        maxTokens:SCHEDULED_MAX_TOKENS,
        concise:true,
      });
      const now = new Date().toISOString();
      const failureById = new Map(failures.map(item => [item.recordId, item.error]));
      const records = state.records.map(record => {
        if (results.has(record.id)) {
          const { aiReviewFailure, ...rest } = record; // 成功后清除退避标记
          return { ...rest, aiReview:results.get(record.id), updatedAt:now, updatedBy:'kimi-scheduled-review' };
        }
        if (failureById.has(record.id)) {
          return { ...record, aiReviewFailure:nextFailureMark(record, failureById.get(record.id)) };
        }
        return record;
      });
      // 失败也要落盘，否则退避计数永远是 0，同一条记录会被无限重试。
      if (results.size || failures.length) await saveState('competitions', records, state.version);
      summary.succeeded = results.size;
      summary.failed = failures.length;
      summary.failures = failures.slice(0, 20);
      summary.remaining = countStaleRecords(records);
    }
    summary.status = runStatus(summary);
  } catch (error) {
    summary.error = String(error?.message || error).slice(0, 500);
    summary.status = runStatus({ ...summary, errored:true });
  }
  summary.completedAt = new Date().toISOString();
  summary.createdAt = summary.completedAt;
  // 成功、部分完成还是抛错都要落一条运行记录，否则定时任务失败时后台完全无感。
  await appendAiReviewRun(summary);
  return summary;
}

// 运行日志写进已有的 admin_state，而不是另建集合：
// 云开发的集合必须先手动创建，写一个不存在的集合会静默失败，等于没有错误上报。
async function appendAiReviewRun(summary) {
  try {
    let runs = [];
    try {
      const current = await db.collection('admin_state').doc(AI_RUN_LOG_DOC).get();
      runs = Array.isArray(current.data?.runs) ? current.data.runs : [];
    } catch (error) {
      if (!(error?.errCode === -1 || /not exist|not found/i.test(error?.message || ''))) throw error;
    }
    await db.collection('admin_state').doc(AI_RUN_LOG_DOC).set({ data:{
      runs:[summary, ...runs].slice(0, MAX_AI_RUN_LOG),
      updated_at:new Date().toISOString(),
    } });
  } catch (error) {
    console.error('ai review run log write failed', error);
  }
}

async function loadLastAiReviewRun() {
  try {
    const result = await db.collection('admin_state').doc(AI_RUN_LOG_DOC).get();
    const runs = Array.isArray(result.data?.runs) ? result.data.runs : [];
    return runs[0] || null;
  } catch (error) {
    return null;
  }
}

async function handle(event) {
  if (event.action === 'bootstrap') return bootstrap();
  if (event.action === 'aiReviewConfig') return aiReviewConfigStatus();
  // 手动跑一次定时任务的同一段逻辑，用于验证触发器之外的部分是否正常。
  if (event.action === 'runScheduledAiReview') return runScheduledCompetitionAiReview('manual');
  // 触发提醒推送：sendReminders 不接受匿名调用（平台返回 EXCEED_AUTHORITY），
  // 所以由已通过管理员认证的 adminData 内部转发，并带上共享密钥。
  if (event.action === 'dispatchReminders') {
    const dispatchSecret = String(process.env.DISPATCH_SECRET || '');
    if (dispatchSecret.length < 24) throw new Error('dispatch_secret_not_configured');
    const response = await cloud.callFunction({
      name:'sendReminders',
      data:{ action:'dispatch', dispatchSecret },
    });
    return response.result || { dispatched:true };
  }
  // 只读：sendReminders 写下的最近一次调用记录，用于确认它的定时触发器是否生效。
  if (event.action === 'reminderInvocationLog') {
    try {
      const result = await db.collection('admin_state').doc('reminder_runs').get();
      return result.data?.last || null;
    } catch (error) {
      return null;
    }
  }
  if (event.action === 'runCompetitionAiReview') {
    const id = String(event.recordId || '').trim();
    if (!id) throw new Error('invalid_record_id');
    const state = await loadState('competitions');
    const record = state.records.find(item => item.id === id);
    if (!record) throw new Error('competition_not_found');
    // 手动审核同样受 60 秒函数上限约束，只是允许比定时任务更长的结论。
    return runCompetitionAiReview(record, undefined, { chatTimeoutMs:MANUAL_CHAT_TIMEOUT_MS, maxTokens:MANUAL_MAX_TOKENS });
  }
  if (event.action === 'saveRecords') {
    const records = requireRecords(event.records, MAX_RECORDS, 'records');
    return saveState('competitions', records, event.expectedVersion, (transaction, current) => syncPublicCache(transaction, current.records || [], records), event.auditEntry);
  }
  if (event.action === 'saveFeedbacks') {
    const records = requireRecords(event.records, MAX_FEEDBACKS, 'feedbacks');
    const updates = requireRecords(event.submittedUpdates || [], 20, 'submitted_feedback_updates');
    return saveState('feedbacks', records, event.expectedVersion, async transaction => ({
      syncedSubmitted:await syncSubmittedFeedbacks(updates, transaction),
    }));
  }
  if (event.action === 'syncFeedbacks') {
    const updates = requireRecords(event.submittedUpdates || [], 20, 'submitted_feedback_updates');
    return { syncedSubmitted:await syncSubmittedFeedbacks(updates) };
  }
  if (event.action === 'saveAiJobs') return saveState('ai_jobs', requireRecords(event.records, MAX_AI_JOBS, 'ai_jobs'), event.expectedVersion);
  if (event.action === 'appendAudit') {
    const safeEntry = buildSafeAuditEntry(event.entry);
    await db.collection('audit_log').doc(safeEntry.id).set({ data: safeEntry });
    return { saved: 1 };
  }
  throw new Error('unsupported_action');
}

exports.main = async event => {
  try {
    const context = cloud.getWXContext();
    // 接受任何定时事件：adminData 只有这一个定时任务，按名字精确匹配只会让
    // 改名或手工新建的触发器被静默丢弃。trigger 字段记下真实名字便于排查。
    if (event?.Type === 'Timer' && event?.Time && !context?.OPENID) {
      return { ok:true, data:await runScheduledCompetitionAiReview(event.TriggerName || 'timer') };
    }
    if (event?.action === 'login') {
      const secret = process.env.ADMIN_TOKEN;
      requireStaticAdminToken(event.adminToken, secret);
      return { ok:true, data:{ sessionToken:issueAdminSession(secret), expiresInSeconds:8 * 60 * 60 } };
    }
    requireAdmin(event || {});
    return { ok: true, data: await handle(event || {}) };
  } catch (error) {
    console.error('adminData failed', { action: event?.action, error });
    return { ok: false, message: error instanceof Error ? error.message : 'admin_data_failed' };
  }
};

exports.runAiReviewPool = runAiReviewPool;
exports.runScheduledCompetitionAiReview = runScheduledCompetitionAiReview;
