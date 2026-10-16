const cloud = require('wx-server-sdk');
const { issueAdminSession, requireStaticAdminToken, verifyAdminSession } = require('./adminAuth');
const { nextStateVersion, normalizeStateVersion } = require('./stateVersion');
const { canonicalFeedbackDocumentId, mergeFeedbackRecords } = require('./feedbackMerge');
const { buildSafeAuditEntry } = require('./auditValidation');
const { SYSTEM_ACTORS, autoAudits } = require('./autoAudit');
const { registrationStatus, syncPublicCache } = require('./publicCache');
const { aiReviewConfigStatus, probeImageCapability, runCompetitionAiReview, runFieldVerification } = require('./competitionAiReview');
const { extractFromDetailPage } = require('./competitionExtract');
const { REASONING_COLLECTION, buildReasoningDoc, createReasoningCollector, saveReasoningDocs } = require('./aiReasoning');
const {
  countStaleRecords, nextFailureMark, runStatus, selectStaleRecords, hasUnresolvedAiReview,
  countStaleForFieldVerification, selectStaleForFieldVerification, nextFieldVerificationFailureMark,
} = require('./aiReviewSchedule');
const { archiveRecord, shouldArchive } = require('./archiveSchedule');
const { evaluateDraftStaleness } = require('./intakeSchedule');
const { registrationScheduleIssues } = require('./registrationSchedule');
const { applyPublishedFieldCorrections } = require('./fieldVerificationIssues');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
// 100 这个数字是当年 CloudBase 单文档 1MB 上限估出来的，自建服务器 + SQLite 后
// 这个限制已经不存在了（服务端请求体上限 10MB，见 apps/server/src/index.mjs）。
// 放宽到 2000，给内容规模增长留够空间。
const MAX_RECORDS = 2000;
// Both scheduled review paths share one model-use lock within this API process.
const recordInFlight = new Set();
const MAX_FEEDBACKS = 1000;
const MAX_AI_JOBS = 1000;
// 实测：单条审核约 50 秒，且 Kimi 端并发请求是排队的，3 条并发只会让后两条超时。
// 所以定时任务每次只处理 1 条。模型超时按剩余预算动态计算（见 runScheduledCompetitionAiReview），
// 因为取证耗时不可预测；超限会被平台直接掐断，连失败记录都写不下。
const SCHEDULED_BATCH_LIMIT = 1;
// 2026-09-29 提示词拆成两问后，2000 会被截断（finish_length）；
// 2026-09-30 要求 Kimi 用中文思考，思考比英文长约一倍，思考和答案共用这个上限，再放宽到 8000
const SCHEDULED_MAX_TOKENS = 8000;
const MANUAL_CHAT_TIMEOUT_MS = 0;
const MANUAL_MAX_TOKENS = 8000;
const AI_RUN_LOG_DOC = 'ai_review_runs';
const MAX_AI_RUN_LOG = 20;
const ARCHIVE_RUN_LOG_DOC = 'archive_runs';
const FIELD_VERIFICATION_RUN_LOG_DOC = 'field_verification_runs';
const STALE_DRAFT_RUN_LOG_DOC = 'stale_draft_runs';
// 三项核验一条约几秒到十几秒（比通用复核轻，不用等证据齐了才问，问题窄），
// 但仍然按同一套"每次只处理少量、跑不完留给下一次"的节奏，避免单次调用超时。
const FIELD_VERIFICATION_BATCH_LIMIT = 1;
const FIELD_VERIFICATION_CHAT_TIMEOUT_MS = 0;
const DISCOVERED_CHANNELS_DOC = 'discovered_channels';
const PIPELINE_RUNS_DOC = 'pipeline_runs';

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

// systemAudits：自动任务的逐条审计（autoAudit.js 生成），与状态在同一事务里写入。
async function saveState(id, records, expectedVersion, transactionWork, auditEntry, systemAudits = []) {
  const safeAuditEntry = auditEntry ? buildSafeAuditEntry(auditEntry) : null;
  const safeSystemAudits = systemAudits.map(entry => buildSafeAuditEntry(entry, { systemActor:entry.systemActor }));
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
    for (const entry of safeSystemAudits) await transaction.collection('audit_log').doc(entry.id).set({ data:entry });
    return { saved:records.length, version, optimisticLockApplied:true, auditSaved:Boolean(safeAuditEntry), systemAudits:safeSystemAudits.length, ...extra };
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
  if (!content || content.length > 2000) throw new Error('invalid_feedback_content');
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
    actor:SYSTEM_ACTORS[item.actor_id] || item.actor_id || item.actor || 'super_admin',
    reason:item.reason || undefined,
    changes,
  };
}

// 只读全量导出，迁移专用。分页取完整表——CloudBase 单次 get 默认只给 100 条，
// 不分页会静默截断，那正是迁移最不能出的错。
const EXPORTABLE = new Set(['admin_state.feedbacks', 'event_edition_public_cache', 'user_account', 'favorite', 'reminder', 'feedback']);

async function exportCollection(name) {
  if (!EXPORTABLE.has(name)) throw new Error(`collection_not_exportable:${name}`);
  if (name.startsWith('admin_state.')) {
    const stateId = name.slice('admin_state.'.length);
    const state = await loadState(stateId);
    return { records: state.records, version: state.version };
  }
  const collection = db.collection(name);
  const all = [];
  const PAGE = 100;
  for (let skip = 0; ; skip += PAGE) {
    let page;
    try {
      page = await collection.skip(skip).limit(PAGE).get();
    } catch (error) {
      // 集合不存在时当成空表：没建过的集合和空集合对迁移来说是一回事。
      if (error?.errCode === -1 || /not exist|not found/i.test(error?.message || '')) break;
      throw error;
    }
    const rows = page.data || [];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

async function bootstrap() {
  const [competitionState, feedbackState, submittedFeedbacks, aiJobState, auditResult, lastAiReviewRun, lastArchiveRun, lastFieldVerificationRun] = await Promise.all([
    loadState('competitions'),
    loadState('feedbacks'),
    loadSubmittedFeedbacks(),
    loadState('ai_jobs'),
    db.collection('audit_log').orderBy('created_at', 'desc').limit(100).get(),
    loadLastAiReviewRun(),
    loadLastArchiveRun(),
    loadLastFieldVerificationRun(),
  ]);
  const feedbacks = mergeFeedbackRecords(feedbackState.records, submittedFeedbacks, MAX_FEEDBACKS);
  return {
    records:competitionState.records,
    feedbacks,
    aiJobs:aiJobState.records,
    audits:(auditResult.data || []).map(auditToAdmin),
    lastAiReviewRun,
    lastArchiveRun,
    lastFieldVerificationRun,
    stateVersions:{ records:competitionState.version, feedbacks:feedbackState.version, aiJobs:aiJobState.version },
  };
}

// Rebase a long model run on the latest state. Never overwrite a record edited meanwhile.
async function commitScheduledChanges(originalRecords, proposedRecords, resolutions, actor) {
  const originals = new Map(originalRecords.map(record => [record.id, record]));
  const proposed = new Map(proposedRecords.map(record => [record.id, record]));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latest = await loadState('competitions');
    const applied = new Map();
    const skipped = [];
    const records = latest.records.flatMap(record => {
      const original = originals.get(record.id);
      if (!original || JSON.stringify(original) === JSON.stringify(proposed.get(record.id))) return [record];
      if (JSON.stringify(original) !== JSON.stringify(record)) { skipped.push(record.id); return [record]; }
      if (resolutions.has(record.id)) applied.set(record.id, resolutions.get(record.id));
      return proposed.has(record.id) ? [proposed.get(record.id)] : [];
    });
    const reasons = new Map([...applied].map(([id, resolution]) => [id, resolution.reason]));
    try {
      const result = await saveState('competitions', records, latest.version, async (transaction, current) => {
        const cacheResult = await syncPublicCache(transaction, current.records || [], records);
        for (const [id, resolution] of applied) {
          if (resolution.outcome !== 'delete') continue;
          const backupId = `resolution-${Date.now()}-${require('crypto').createHash('sha256').update(id).digest('hex').slice(0, 16)}`;
          await transaction.collection('ai_resolution_backups').doc(backupId).set({ data:{
            record:originals.get(id), recordId:id, outcome:'delete', reason:resolution.reason,
            evidence:resolution.agentResult || null, createdAt:new Date().toISOString(), actor,
          } });
        }
        return cacheResult;
      }, null, autoAudits(latest.records, records, actor, new Date(), reasons));
      return { ...result, records, skipped, resolutions:[...applied].map(([id, value]) => ({id,outcome:value.outcome,reason:value.reason})) };
    } catch (error) {
      if (attempt === 2 || !/version|conflict/i.test(String(error?.message || error))) throw error;
    }
  }
}

async function resolveReviewFailure(record, review, options) {
  const resolve = options.resolveFailedCompetition || require('./kimiReviewDisposition').resolveFailedCompetition;
  const resolution = await resolve(record, review, { ...options, records:options.allRecords || [] });
  if (!resolution || !['published','archived','draft','delete'].includes(resolution.outcome)
      || (resolution.outcome === 'delete' ? resolution.record !== null
        : resolution.record?.id !== record.id || resolution.record?.dataStatus !== resolution.outcome)
      || !String(resolution.reason || '').trim()) throw new Error('invalid_kimi_resolution_result');
  return resolution;
}

async function runAiReviewPool(records, concurrency = 5, options = {}) {
  const results = new Map();
  const resolutions = new Map();
  const failures = [];
  const inFlightSkipped = [];
  let cursor = 0;
  async function worker() {
    while (cursor < records.length) {
      const record = records[cursor++];
      if (recordInFlight.has(record.id)) { inFlightSkipped.push(record.id); continue; }
      recordInFlight.add(record.id);
      // 这次审核里 Kimi 的思考过程，审核结束后写进 ai_reasoning（成功失败都记，失败时更需要看它想了什么）
      const collector = createReasoningCollector({ recordId:record.id, recordName:record.name });
      try {
        if (hasUnresolvedAiReview(record)) {
          resolutions.set(record.id, await resolveReviewFailure(record, record.aiReview, { ...options, onReasoning:collector.onReasoning }));
          results.set(record.id, record.aiReview);
          continue;
        }
        const review = await (options.runReview || runCompetitionAiReview)(record, undefined, { ...options, onReasoning:collector.onReasoning });
        if (review.decision !== 'recommend_approve' || registrationScheduleIssues(record.schedule).length
            || !['published','archived'].includes(record.dataStatus)) {
          resolutions.set(record.id, await resolveReviewFailure(record, review, { ...options, onReasoning:collector.onReasoning }));
        }
        results.set(record.id, review);
      } catch (error) {
        failures.push({ recordId:record.id, recordName:record.name, error:String(error?.message || error).slice(0, 500) });
      } finally {
        try { await saveReasoningDocs(db, collector.docs()); }
        finally { recordInFlight.delete(record.id); }
      }
    }
  }
  await Promise.all(Array.from({ length:Math.min(concurrency, records.length) }, () => worker()));
  return { results, resolutions, failures, inFlightSkipped };
}

function scheduledBatchLimit() {
  const configured = Number(process.env.AI_REVIEW_CONCURRENCY || SCHEDULED_BATCH_LIMIT);
  return Number.isInteger(configured) ? Math.min(10, Math.max(1, configured)) : SCHEDULED_BATCH_LIMIT;
}

// 自建服务器不再沿用云函数 60 秒总预算；仍每次只审核少量记录，
// 防止定时任务重叠和同一批次写库冲突。
function selectRequestedReviewRecords(records, trigger, requestedRecordIds = []) {
  if (!Array.isArray(requestedRecordIds) || requestedRecordIds.length > 10
      || requestedRecordIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 200)) {
    throw new Error('invalid_manual_ai_review_record_ids');
  }
  if (!requestedRecordIds.length) return null;
  if (trigger !== 'manual') throw new Error('manual_ai_review_retry_required');
  const requested = new Set(requestedRecordIds);
  return records.filter(record => requested.has(record.id) && !recordInFlight.has(record.id) && !['archived','quarantined'].includes(record.dataStatus));
}

const quotaPauseModule = require('./aiQuotaPause');
// 这一轮有因为额度用完失败的：暂停 5 小时；有调用成功的：说明额度已恢复，清掉暂停
async function applyQuotaOutcome(summary, failures, succeeded) {
  const quotaFailure = failures.find(item => quotaPauseModule.isQuotaError(item.error));
  if (quotaFailure) {
    const pause = quotaPauseModule.nextPause(quotaFailure.error, new Date(), await quotaPauseModule.readPause(db));
    await quotaPauseModule.writePause(db, pause);
    summary.pausedUntil = pause.pausedUntil;
  } else if (succeeded) {
    await quotaPauseModule.clearPause(db);
  }
}

async function runScheduledCompetitionAiReview(trigger = 'timer', requestedRecordIds = []) {
  const startedAt = new Date().toISOString();
  const summary = {
    trigger, startedAt, completedAt:startedAt,
    selected:0, succeeded:0, failed:0, remaining:0,
    status:'failed', failures:[],
  };
  try {
    const state = await loadState('competitions');
    const limit = scheduledBatchLimit();
    const requested = selectRequestedReviewRecords(state.records, trigger, requestedRecordIds);
    // Kimi 额度用完时暂停 5 小时（aiQuotaPause.js）；后台手动指定记录的照常跑
    const quotaPause = requested === null ? quotaPauseModule.activePause(await quotaPauseModule.readPause(db)) : null;
    if (quotaPause) {
      summary.status = 'paused';
      summary.pausedUntil = quotaPause.pausedUntil;
      summary.remaining = countStaleRecords(state.records);
      summary.completedAt = new Date().toISOString();
      summary.createdAt = summary.completedAt;
      return summary;
    }
    const due = requested === null ? selectStaleRecords(state.records.filter(record => !recordInFlight.has(record.id)), { limit }) : requested;
    if (requested !== null) summary.requestedRecordIds = [...new Set(requestedRecordIds)];
    summary.selected = due.length;
    if (due.length) {
      const chatTimeoutMs = 0;
      summary.chatTimeoutMs = chatTimeoutMs;
      const { results, resolutions, failures, inFlightSkipped } = await runAiReviewPool(due, due.length, {
        chatTimeoutMs,
        maxTokens:SCHEDULED_MAX_TOKENS,
        concise:true,
        allRecords:state.records,
      });
      summary.inFlightSkipped = inFlightSkipped;
      summary.selected = results.size + failures.length;
      const now = new Date().toISOString();
      const failureById = new Map(failures.map(item => [item.recordId, item.error]));
      let records = state.records.map(record => {
        if (resolutions.has(record.id)) return resolutions.get(record.id).record;
        if (results.has(record.id)) {
          const { aiReviewFailure, ...rest } = record; // 成功后清除退避标记
          return require('./quarantine').isolateMisimport({ ...rest, aiReview:results.get(record.id), updatedAt:now, updatedBy:'kimi-scheduled-review' }, now);
        }
        // 额度用完不是这条记录的问题，不加失败退避标记
        if (failureById.has(record.id) && !quotaPauseModule.isQuotaError(failureById.get(record.id))) {
          return { ...record, aiReviewFailure:nextFailureMark(record, failureById.get(record.id)) };
        }
        return record;
      }).filter(Boolean);
      // 失败也要落盘，否则退避计数永远是 0，同一条记录会被无限重试。
      if (results.size || failures.length) {
        const committed = await commitScheduledChanges(state.records, records, resolutions, 'ai-review');
        summary.resolutions = committed.resolutions;
        summary.skipped = committed.skipped;
        records = committed.records;
      }
      summary.succeeded = results.size;
      summary.failed = failures.length;
      summary.failures = failures.slice(0, 20);
      summary.remaining = countStaleRecords(records);
      await applyQuotaOutcome(summary, failures, results.size);
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

// 报名已截止的已发布赛事定期归档：撤出公开缓存（学生端看不到），记录本身
// 保留（不是删除），附上"下一届大概什么时候开始报名"的粗略估算。
// 和 AI 审核走同一套节奏——由外部定时器（自有服务器 systemd timer 或
// CloudBase 定时触发器）调用这个 action，不在函数里自己维护 cron。
async function archiveExpiredRegistrations(trigger = 'manual') {
  const startedAt = new Date();
  const summary = { trigger, startedAt:startedAt.toISOString(), scanned:0, archived:0, results:[] };
  try {
    const state = await loadState('competitions');
    summary.scanned = state.records.length;
    const results = [];
    const nextRecords = state.records.map(record => {
      if (registrationScheduleIssues(record.schedule).length || !shouldArchive(record, registrationStatus, startedAt)) return record;
      const updated = archiveRecord(record, startedAt);
      results.push({ id:record.id, name:record.name, nextEditionEstimate:updated.nextEditionEstimate });
      return updated;
    });
    summary.archived = results.length;
    summary.results = results;
    if (results.length) {
      await saveState('competitions', nextRecords, state.version, (transaction, current) => syncPublicCache(transaction, current.records || [], nextRecords), null, autoAudits(state.records, nextRecords, 'archive-job'));
    }
    summary.status = 'completed';
  } catch (error) {
    summary.status = 'failed';
    summary.error = String(error?.message || error).slice(0, 500);
  }
  summary.completedAt = new Date().toISOString();
  summary.createdAt = summary.completedAt;
  await appendArchiveRun(summary);
  return summary;
}

async function appendArchiveRun(summary) {
  try {
    let runs = [];
    try {
      const current = await db.collection('admin_state').doc(ARCHIVE_RUN_LOG_DOC).get();
      runs = Array.isArray(current.data?.runs) ? current.data.runs : [];
    } catch (error) {
      if (!(error?.errCode === -1 || /not exist|not found/i.test(error?.message || ''))) throw error;
    }
    await db.collection('admin_state').doc(ARCHIVE_RUN_LOG_DOC).set({ data:{
      runs:[summary, ...runs].slice(0, MAX_AI_RUN_LOG),
      updated_at:new Date().toISOString(),
    } });
  } catch (error) {
    console.error('archive run log write failed', error);
  }
}

async function loadLastArchiveRun() {
  try {
    const result = await db.collection('admin_state').doc(ARCHIVE_RUN_LOG_DOC).get();
    const runs = Array.isArray(result.data?.runs) ? result.data.runs : [];
    return runs[0] || null;
  } catch (error) {
    return null;
  }
}

async function runFieldVerificationPool(records, options = {}) {
  const results = new Map();
  const resolutions = new Map();
  const failures = [];
  const inFlightSkipped = [];
  for (const record of records) {
    if (recordInFlight.has(record.id)) { inFlightSkipped.push(record.id); continue; }
    recordInFlight.add(record.id);
    const collector = createReasoningCollector({ recordId:record.id, recordName:record.name });
    try {
      const review = await (options.runReview || runFieldVerification)(record, undefined, { ...options, onReasoning:collector.onReasoning });
      if (!review.all_correct || registrationScheduleIssues(record.schedule).length || applyPublishedFieldCorrections(record, review, new Date()).needsManualReview) {
        resolutions.set(record.id, await resolveReviewFailure(record, review, { ...options, onReasoning:collector.onReasoning }));
      }
      results.set(record.id, review);
    } catch (error) {
      failures.push({ recordId:record.id, recordName:record.name, error:String(error?.message || error).slice(0, 500) });
    } finally {
      try { await saveReasoningDocs(db, collector.docs()); }
      finally { recordInFlight.delete(record.id); }
    }
  }
  return { results, resolutions, failures, inFlightSkipped };
}

async function runScheduledPublishedVerification(trigger = 'timer') {
  const startedAt = new Date();
  const summary = {
    trigger, startedAt:startedAt.toISOString(), completedAt:startedAt.toISOString(),
    archived:0, selected:0, succeeded:0, corrected:0, flagged:0, failed:0,
    status:'failed', failures:[],
  };
  try {
    const state = await loadState('competitions');

    // 第一步：报名已经截止的已发布记录，直接归档，不进三项核验。
    const afterArchive = state.records.map(record => {
      if (registrationScheduleIssues(record.schedule).length || !shouldArchive(record, registrationStatus, startedAt)) return record;
      summary.archived += 1;
      return archiveRecord(record, startedAt);
    });

    // Kimi 额度用完时暂停 5 小时：只做不调用 AI 的归档，不做三项核验
    const quotaPause = quotaPauseModule.activePause(await quotaPauseModule.readPause(db));
    if (quotaPause) summary.pausedUntil = quotaPause.pausedUntil;
    const due = quotaPause ? [] : selectStaleForFieldVerification(afterArchive.filter(record => !recordInFlight.has(record.id)), { limit:FIELD_VERIFICATION_BATCH_LIMIT });
    summary.selected = due.length;

    let nextRecords = afterArchive;
    if (summary.archived || due.length) {
      const { results, resolutions, failures, inFlightSkipped } = due.length
        ? await runFieldVerificationPool(due, { chatTimeoutMs:FIELD_VERIFICATION_CHAT_TIMEOUT_MS, allRecords:state.records })
        : { results:new Map(), resolutions:new Map(), failures:[], inFlightSkipped:[] };
      summary.inFlightSkipped = inFlightSkipped;
      summary.selected = results.size + failures.length;
      const now = new Date();
      const failureById = new Map(failures.map(item => [item.recordId, item.error]));
      nextRecords = afterArchive.map(record => {
        if (resolutions.has(record.id)) {
          const resolution = resolutions.get(record.id);
          if (resolution.outcome === 'archived') summary.archived += 1;
          if (resolution.outcome === 'published') summary.corrected += 1;
          if (resolution.outcome === 'draft') summary.flagged += 1;
          return resolution.record;
        }
        if (results.has(record.id)) {
          const { fieldVerificationFailure, ...rest } = record; // 成功后清除退避标记
          const updated = applyPublishedFieldCorrections(rest, results.get(record.id), now);
          if (updated.needsManualReview) summary.flagged += 1;
          else if (!results.get(record.id).all_correct) summary.corrected += 1;
          return updated;
        }
        if (failureById.has(record.id) && !quotaPauseModule.isQuotaError(failureById.get(record.id))) {
          return { ...record, fieldVerificationFailure:nextFieldVerificationFailureMark(record, failureById.get(record.id), now) };
        }
        return record;
      }).filter(Boolean);
      summary.succeeded = results.size;
      summary.failed = failures.length;
      summary.failures = failures.slice(0, 20);
      await applyQuotaOutcome(summary, failures, results.size);
      const committed = await commitScheduledChanges(state.records, nextRecords, resolutions, 'field-verification');
      nextRecords = committed.records;
      summary.resolutions = committed.resolutions;
      summary.skipped = committed.skipped;
    }
    summary.remaining = countStaleForFieldVerification(nextRecords);
    summary.status = summary.failed && !summary.succeeded && due.length ? 'failed' : (summary.selected || summary.archived ? 'completed' : (summary.pausedUntil ? 'paused' : 'idle'));
  } catch (error) {
    summary.error = String(error?.message || error).slice(0, 500);
    summary.status = 'failed';
  }
  summary.completedAt = new Date().toISOString();
  summary.createdAt = summary.completedAt;
  await appendFieldVerificationRun(summary);
  return summary;
}

async function appendFieldVerificationRun(summary) {
  try {
    let runs = [];
    try {
      const current = await db.collection('admin_state').doc(FIELD_VERIFICATION_RUN_LOG_DOC).get();
      runs = Array.isArray(current.data?.runs) ? current.data.runs : [];
    } catch (error) {
      if (!(error?.errCode === -1 || /not exist|not found/i.test(error?.message || ''))) throw error;
    }
    await db.collection('admin_state').doc(FIELD_VERIFICATION_RUN_LOG_DOC).set({ data:{
      runs:[summary, ...runs].slice(0, MAX_AI_RUN_LOG),
      updated_at:new Date().toISOString(),
    } });
  } catch (error) {
    console.error('field verification run log write failed', error);
  }
}

async function loadLastFieldVerificationRun() {
  try {
    const result = await db.collection('admin_state').doc(FIELD_VERIFICATION_RUN_LOG_DOC).get();
    const runs = Array.isArray(result.data?.runs) ? result.data.runs : [];
    return runs[0] || null;
  } catch (error) {
    return null;
  }
}

// 草稿超时兜底：不管是没日期、Kimi核验没通过、还是核验调用失败，只要
// 一条草稿超过3天还没变成"已发布"或"已归档"，就该让人看一眼、并且看得到
// 具体原因——而不是安静地躺在176条草稿里没人知道该先看哪条。
// hold（半年以外先放着）的草稿在 ingest-candidates.mjs 里已经打了
// stalenessExempt，evaluateDraftStaleness 会自动跳过，不会被误报。
async function flagStaleDrafts(trigger = 'manual') {
  const startedAt = new Date();
  const summary = { trigger, startedAt:startedAt.toISOString(), scanned:0, flagged:0, results:[] };
  try {
    const state = await loadState('competitions');
    summary.scanned = state.records.length;
    const results = [];
    const nextRecords = state.records.map(record => {
      if (record.needsManualReview) return record; // 已经标过的不用重复标
      const { stale, reason } = evaluateDraftStaleness(record, startedAt);
      if (!stale) return record;
      results.push({ id:record.id, name:record.name, reason });
      return { ...record, needsManualReview:true, staleDraftReason:reason, updatedAt:startedAt.toISOString(), updatedBy:'stale-draft-flag' };
    });
    summary.flagged = results.length;
    summary.results = results;
    if (results.length) await saveState('competitions', nextRecords, state.version, null, null, autoAudits(state.records, nextRecords, 'stale-draft-check'));
    summary.status = 'completed';
  } catch (error) {
    summary.status = 'failed';
    summary.error = String(error?.message || error).slice(0, 500);
  }
  summary.completedAt = new Date().toISOString();
  summary.createdAt = summary.completedAt;
  await appendStaleDraftRun(summary);
  return summary;
}

async function appendStaleDraftRun(summary) {
  try {
    let runs = [];
    try {
      const current = await db.collection('admin_state').doc(STALE_DRAFT_RUN_LOG_DOC).get();
      runs = Array.isArray(current.data?.runs) ? current.data.runs : [];
    } catch (error) {
      if (!(error?.errCode === -1 || /not exist|not found/i.test(error?.message || ''))) throw error;
    }
    await db.collection('admin_state').doc(STALE_DRAFT_RUN_LOG_DOC).set({ data:{
      runs:[summary, ...runs].slice(0, MAX_AI_RUN_LOG),
      updated_at:new Date().toISOString(),
    } });
  } catch (error) {
    console.error('stale draft run log write failed', error);
  }
}

async function loadDiscoveredChannels() {
  try {
    const result = await db.collection('admin_state').doc(DISCOVERED_CHANNELS_DOC).get();
    return result.data?.channels && typeof result.data.channels === 'object' ? result.data.channels : {};
  } catch (error) {
    return {};
  }
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
  if (event.action === 'listGeneralFeedback') return require('./generalFeedback').list(db, event);
  if (event.action === 'updateGeneralFeedback') return require('./generalFeedback').update(db, event);
  if (event.action === 'bootstrap') return bootstrap();
  // 小程序访问异常（clientIssues.js）：服务器 pull-client-logs.mjs 从上海拉回来后经这里写库。
  // 按上海那边的 _id / 日期存，重复拉取会覆盖成同一条，不会重复计数。
  if (event.action === 'saveClientLogs') {
    const issues = (Array.isArray(event.issues) ? event.issues : []).slice(0, 500);
    const stats = (Array.isArray(event.stats) ? event.stats : []).slice(0, 100);
    let savedIssues = 0;
    for (const issue of issues) {
      const id = String(issue?._id || '').slice(0, 80);
      if (!/^[A-Za-z0-9_-]{6,80}$/.test(id) || typeof issue.kind !== 'string') continue;
      // 只留已知字段，每个截断（上海 clientLog 已经清洗过一次，这里不信任外部数据，再做一次）
      const data = { kind:String(issue.kind).slice(0, 30) };
      for (const field of ['at', 'received_at', 'page', 'action', 'message', 'extra', 'networkType', 'platform', 'system', 'wechatVersion', 'sdkVersion', 'appVersion', 'envVersion']) {
        data[field] = String(issue[field] ?? '').slice(0, 300);
      }
      data.elapsed_ms = issue.elapsed_ms != null && Number.isFinite(Number(issue.elapsed_ms)) ? Number(issue.elapsed_ms) : null;
      await db.collection('client_issues').doc(id).set({ data });
      savedIssues += 1;
    }
    let savedStats = 0;
    for (const row of stats) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row?.date || ''))) continue;
      await db.collection('client_stats').doc(row.date).set({ data:{ date:row.date, list:Number(row.list) || 0, get:Number(row.get) || 0 } });
      savedStats += 1;
    }
    return { savedIssues, savedStats };
  }
  // 偏好问卷统计（2026-10-09 起）：pull-client-logs.mjs 从上海 publicSync 的 pullPreferenceStats 拉回的计数快照，
  // 只有计数、没有账号信息。整份覆盖成一条（id=latest）。
  if (event.action === 'savePreferenceStats') {
    const stats = event.stats || {};
    const counts = value => Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {})
      .filter(([key, n]) => typeof key === 'string' && key.length <= 30 && Number.isFinite(Number(n))).slice(0, 60).map(([key, n]) => [key, Number(n)]));
    const data = { total:Number(stats.total) || 0, completed:Number(stats.completed) || 0, skipped:Number(stats.skipped) || 0,
      noProfession:Number(stats.noProfession) || 0, noCategory:Number(stats.noCategory) || 0, noProvince:Number(stats.noProvince) || 0,
      profession:counts(stats.profession), categories:counts(stats.categories), province:counts(stats.province),
      generatedAt:String(stats.generatedAt || '').slice(0, 40), pulledAt:new Date().toISOString() };
    await db.collection('preference_stats').doc('latest').set({ data });
    return { saved:true };
  }
  if (event.action === 'preferenceStats') {
    try { return (await db.collection('preference_stats').doc('latest').get()).data || null; }
    catch (error) { if (error?.errCode === -1 || /not exist|not found/i.test(error?.message || '')) return null; throw error; }
  }
  // 后台“接口用量”页（2026-10-10 起）：各接口每天的调用量、用在哪里（只读，读服务器上的调用账）
  if (event.action === 'apiUsage') {
    return require('./apiUsageReport').buildApiUsageReport({ days:event.days });
  }
  // 后台“访问异常”页：最近 N 天的成功率、各类异常、最近的异常明细（只读）
  if (event.action === 'clientIssues') {
    const days = Math.min(60, Math.max(1, Number(event.days) || 14));
    const read = async name => {
      try { return (await db.collection(name).limit(20000).get()).data || []; }
      catch (error) { if (error?.errCode === -1 || /not exist|not found/i.test(error?.message || '')) return []; throw error; }
    };
    return require('./clientIssues').aggregateClientIssues(await read('client_issues'), await read('client_stats'), { days });
  }
  // AI 思考过程（aiReasoning.js）：按赛事列出，最新的在前（只读）
  if (event.action === 'listAiReasoning') {
    const recordId = String(event.recordId || '').trim();
    if (!recordId) throw new Error('invalid_record_id');
    try {
      const result = await db.collection(REASONING_COLLECTION).where({ record_id:recordId })
        .orderBy('created_at', 'desc').limit(Math.min(50, Math.max(1, Number(event.limit) || 20))).get();
      return result.data || [];
    } catch (error) {
      if (error?.errCode === -1 || /not exist|not found/i.test(error?.message || '')) return [];
      throw error;
    }
  }
  // 服务器脚本（入库时的收录判断、三项核验等）产生的思考过程，经这里写库
  if (event.action === 'saveAiReasoning') {
    const docs = (Array.isArray(event.docs) ? event.docs : []).slice(0, 200)
      .filter(doc => doc && typeof doc.text === 'string' && doc.text.trim())
      .map(doc => buildReasoningDoc({
        kind:String(doc.kind || 'unknown').slice(0, 40),
        recordId:doc.record_id ? String(doc.record_id).slice(0, 120) : null,
        recordName:doc.record_name, url:doc.url, model:doc.model, provider:doc.provider,
        reasoning:{ text:doc.text, tokens:Number.isFinite(doc.tokens) ? doc.tokens : null, finishReason:doc.finish_reason || null },
        createdAt:Number.isNaN(Date.parse(doc.created_at)) ? new Date().toISOString() : new Date(doc.created_at).toISOString(),
        // extra 只收简单的键值（轮次、触发方式、运行编号之类），防止塞进大对象
        extra:doc.extra && typeof doc.extra === 'object' ? Object.fromEntries(Object.entries(doc.extra).slice(0, 10)
          .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
          .map(([key, value]) => [String(key).slice(0, 40), typeof value === 'string' ? value.slice(0, 300) : value])) : null,
      }));
    return { saved:await saveReasoningDocs(db, docs) };
  }
  // 单轮抓取明细：读服务器 runs/<运行编号>/ 下的各阶段文件，逐条列出去向（只读）
  if (event.action === 'pipelineRunDetail') return require('./pipelineRunDetail').loadRunDetail(event.runId);
  if (event.action === 'listPipelineRuns') {
    try {
      const result = await db.collection('admin_state').doc(PIPELINE_RUNS_DOC).get();
      return { runs:Array.isArray(result.data?.runs) ? result.data.runs : [] };
    } catch (error) {
      if (error?.errCode === -1 || /not exist|not found/i.test(error?.message || '')) return { runs:[] };
      throw error;
    }
  }
  if (event.action === 'savePipelineRun') {
    const run = event.run;
    if (!run || typeof run !== 'object' || !/^[\w-]{12,80}$/.test(run.id || '')
      || !Number.isFinite(Date.parse(run.finishedAt)) || JSON.stringify(run).length > 30000) {
      throw new Error('invalid_pipeline_run');
    }
    return db.runTransaction(async transaction => {
      let previous = [];
      try {
        const result = await transaction.collection('admin_state').doc(PIPELINE_RUNS_DOC).get();
        previous = Array.isArray(result.data?.runs) ? result.data.runs : [];
      } catch (error) {
        if (!(error?.errCode === -1 || /not exist|not found/i.test(error?.message || ''))) throw error;
      }
      const runs = [run, ...previous.filter(item => item.id !== run.id)]
        .sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt))).slice(0, 100);
      await transaction.collection('admin_state').doc(PIPELINE_RUNS_DOC).set({ data:{ runs, updated_at:new Date().toISOString() } });
      return { saved:1, total:runs.length };
    });
  }
  // 只读全量导出，专门给迁移到自有服务器用（见 docs/migration-to-self-hosted.md）。
  // userData 刻意只让用户读自己的数据，所以按用户存的那几张表没有全量接口——
  // 这个口子只有 ADMIN_TOKEN 能调，且只读不写。迁完可以删掉。
  if (event.action === 'exportCollection') return exportCollection(String(event.collection || ''));
  // 可复用信源资产：抓取流水线发现的、值得下次继续盯的网站域名清单
  // （见 scripts/crawler/lib/discoveredChannels.js）。合并逻辑在调用方做，
  // 这里只负责读写整份 JSON——调用方只有抓取流水线自己（串行跑，没有并发
  // 写入的风险），所以没有像 competitions 那样上乐观锁，保持简单。
  if (event.action === 'listDiscoveredChannels') return loadDiscoveredChannels();
  if (event.action === 'saveDiscoveredChannels') {
    const channels = event.channels && typeof event.channels === 'object' ? event.channels : null;
    if (!channels) throw new Error('invalid_channels');
    await db.collection('admin_state').doc(DISCOVERED_CHANNELS_DOC).set({ data:{ channels, updated_at:new Date().toISOString() } });
    return { saved:Object.keys(channels).length };
  }
  // 百度搜索的屏蔽网站名单（siteBlocklist.js）：读名单、统计脚本写建议、后台确认或忽略
  if (event.action === 'siteBlocklist') return require('./siteBlocklist').loadSiteBlocklist(db);
  if (event.action === 'saveSiteBlockSuggestions') return require('./siteBlocklist').saveSuggestions(db, event);
  if (event.action === 'decideSiteBlock') {
    return require('./siteBlocklist').decideSiteBlock(db, { host:event.host, decision:event.decision, note:event.note });
  }
  if (event.action === 'aiReviewConfig') return aiReviewConfigStatus();
  // 一次性探测：当前模型是否真的接受图片输入。
  if (event.action === 'aiImageProbe') {
    const imageUrl = String(event.imageUrl || '').trim();
    // 同时允许 data: URI，用于测试内联 base64 是否比远程 URL 更被接受
    if (!/^(https?:\/\/|data:image\/)/i.test(imageUrl)) throw new Error('invalid_image_url');
    return probeImageCapability(imageUrl, undefined, { chatTimeoutMs:MANUAL_CHAT_TIMEOUT_MS });
  }
  // 从一个详情页抽取字段建议。抓取拿到的列表接口只给得出奖金和参赛规模，
  // 「主办方是谁」「有没有直通面试」藏在正文里，收录判定卡在这一步。
  // 抽取只产出建议并逐字回查引文，不写库。
  if (event.action === 'extractFromDetailPage') {
    const url = String(event.url || '').trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('invalid_detail_url');
    return extractFromDetailPage(url, undefined, {
      contestName:String(event.contestName || '').slice(0, 120),
      // 前后端分离的站点由调用方走它自己的接口取正文后传进来；
      // 上限比 PAGE_TEXT_LIMIT 略宽，留给去标签前的余量。
      text:String(event.text || '').slice(0, 20000),
      chatTimeoutMs:MANUAL_CHAT_TIMEOUT_MS,
    });
  }
  // 手动跑一次定时任务的同一段逻辑，用于验证触发器之外的部分是否正常。
  if (event.action === 'runScheduledAiReview') return runScheduledCompetitionAiReview('manual', event.recordIds === undefined ? [] : event.recordIds);
  if (event.action === 'archiveExpiredRegistrations') return archiveExpiredRegistrations('manual');
  if (event.action === 'runScheduledFieldVerification') return runScheduledPublishedVerification(event.trigger || 'manual');
  if (event.action === 'flagStaleDrafts') return flagStaleDrafts(event.trigger || 'manual');
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
    if (record.dataStatus === 'quarantined') throw new Error('请先补齐资料并恢复为合格草稿，再执行审核');
    // 手动审核同样受 60 秒函数上限约束，只是允许比定时任务更长的结论。
    const collector = createReasoningCollector({ recordId:record.id, recordName:record.name, extra:{ trigger:'manual' } });
    try {
      return await runCompetitionAiReview(record, undefined, { chatTimeoutMs:MANUAL_CHAT_TIMEOUT_MS, maxTokens:MANUAL_MAX_TOKENS, onReasoning:collector.onReasoning });
    } finally {
      await saveReasoningDocs(db, collector.docs());
    }
  }
  if (event.action === 'saveOperationState') {
    const specs = [['records','competitions',MAX_RECORDS],['feedbacks','feedbacks',MAX_FEEDBACKS],['aiJobs','ai_jobs',MAX_AI_JOBS]];
    const writes = specs.filter(([key]) => event[key] !== undefined).map(([key,id,max]) => ({key,id,records:requireRecords(event[key],max,key)}));
    if (!writes.length) throw new Error('empty_operation_state');
    const auditEntries = requireRecords(event.auditEntries || [],MAX_FEEDBACKS,'audit_entries').map(entry => buildSafeAuditEntry(entry));
    const updates = requireRecords(event.submittedUpdates || [],MAX_FEEDBACKS,'submitted_feedback_updates');
    return db.runTransaction(async transaction => {
      const versions = {};
      for (const write of writes) {
        let current = {version:0,records:[]};
        try { current = (await transaction.collection('admin_state').doc(write.id).get()).data || current; }
        catch (error) { if (!(error?.errCode === -1 || /not exist|not found/i.test(error?.message || ''))) throw error; }
        versions[write.key] = nextStateVersion(write.id,current.version,event.expectedVersions?.[write.key]);
        if (write.key === 'records') {
          require('./competitionScope').requireScopeForNewRecords(current.records || [],write.records);
          require('./quarantine').requireReviewDisposition(current.records || [],write.records);
          require('./quarantine').requireQuarantineRecovery(current.records || [],write.records);
          await syncPublicCache(transaction,current.records || [],write.records);
        }
        await transaction.collection('admin_state').doc(write.id).set({data:{records:write.records,version:versions[write.key],updated_at:new Date().toISOString(),updated_by:'super_admin'}});
      }
      if (updates.length) await syncSubmittedFeedbacks(updates,transaction);
      for (const entry of auditEntries) await transaction.collection('audit_log').doc(entry.id).set({data:entry});
      return {versions};
    });
  }
  if (event.action === 'saveRecords') {
    const records = requireRecords(event.records, MAX_RECORDS, 'records');
    return saveState('competitions', records, event.expectedVersion, (transaction, current) => {
      require('./competitionScope').requireScopeForNewRecords(current.records || [], records);
      require('./quarantine').requireReviewDisposition(current.records || [], records);
      require('./quarantine').requireQuarantineRecovery(current.records || [], records);
      return syncPublicCache(transaction, current.records || [], records);
    }, event.auditEntry);
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
exports.archiveExpiredRegistrations = archiveExpiredRegistrations;
exports.runScheduledPublishedVerification = runScheduledPublishedVerification;
exports.flagStaleDrafts = flagStaleDrafts;

exports.runFieldVerificationPool = runFieldVerificationPool;
exports.commitScheduledChanges = commitScheduledChanges;

exports.selectRequestedReviewRecords = selectRequestedReviewRecords;
