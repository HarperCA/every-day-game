const cloud = require('wx-server-sdk');
const { issueAdminSession, requireStaticAdminToken, verifyAdminSession } = require('./adminAuth');
const { nextStateVersion, normalizeStateVersion } = require('./stateVersion');
const { canonicalFeedbackDocumentId, mergeFeedbackRecords } = require('./feedbackMerge');
const { buildSafeAuditEntry } = require('./auditValidation');
const { syncPublicCache } = require('./publicCache');
const { runCompetitionAiReview } = require('./competitionAiReview');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const MAX_RECORDS = 100;
const MAX_FEEDBACKS = 1000;
const MAX_AI_JOBS = 1000;

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
  const [competitionState, feedbackState, submittedFeedbacks, aiJobState, auditResult] = await Promise.all([
    loadState('competitions'),
    loadState('feedbacks'),
    loadSubmittedFeedbacks(),
    loadState('ai_jobs'),
    db.collection('audit_log').orderBy('created_at', 'desc').limit(100).get(),
  ]);
  const feedbacks = mergeFeedbackRecords(feedbackState.records, submittedFeedbacks, MAX_FEEDBACKS);
  return {
    records:competitionState.records,
    feedbacks,
    aiJobs:aiJobState.records,
    audits:(auditResult.data || []).map(auditToAdmin),
    stateVersions:{ records:competitionState.version, feedbacks:feedbackState.version, aiJobs:aiJobState.version },
  };
}

async function handle(event) {
  if (event.action === 'bootstrap') return bootstrap();
  if (event.action === 'runCompetitionAiReview') {
    const id = String(event.recordId || '').trim();
    if (!id) throw new Error('invalid_record_id');
    const state = await loadState('competitions');
    const record = state.records.find(item => item.id === id);
    if (!record) throw new Error('competition_not_found');
    return runCompetitionAiReview(record);
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
    await db.collection('audit_log').doc(entry.id).set({ data: safeEntry });
    return { saved: 1 };
  }
  throw new Error('unsupported_action');
}

exports.main = async event => {
  try {
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
