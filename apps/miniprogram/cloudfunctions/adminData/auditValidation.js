const AUDIT_ACTIONS = new Set([
  'create', 'update', 'reset', 'submit_review', 'approve', 'reject', 'publish', 'unpublish', 'archive', 'offline', 'delete',
  'manual_review_pass', 'manual_review_reject', 'profession_mapping_update',
  'system_validation_run',
  'feedback_ai_queue', 'feedback_accept', 'feedback_reject', 'feedback_spotcheck_correct', 'feedback_spotcheck_incorrect', 'feedback_update',
  'ai_job_retry', 'ai_job_manual', 'ai_job_resolve', 'ai_job_update',
]);
const AUDIT_OBJECT_TYPES = new Set(['event_master', 'event_edition', 'event_track', 'event_schedule', 'recommendation', 'data_source', 'feedback', 'ai_job']);

function validateAuditIdentity(entry) {
  if (!entry || typeof entry.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(entry.id)) throw new Error('invalid_audit_entry');
  const action = String(entry.action || '');
  const objectType = String(entry.objectType || 'event_edition');
  if (!AUDIT_ACTIONS.has(action)) throw new Error('invalid_audit_action');
  if (!AUDIT_OBJECT_TYPES.has(objectType)) throw new Error('invalid_audit_object_type');
  if (typeof entry.recordId !== 'string' || !entry.recordId || entry.recordId.length > 200) throw new Error('invalid_audit_record_id');
  return { action, objectType };
}

// systemActor 只由服务器端自动任务传入（autoAudit.js），后台提交的审计一律记为 super_admin。
function buildSafeAuditEntry(entry, { systemActor } = {}) {
  const auditIdentity = validateAuditIdentity(entry);
  const changedFields = Array.isArray(entry.changedFields) ? entry.changedFields.filter(field => typeof field === 'string').slice(0, 100) : [];
  const changes = entry.changes && typeof entry.changes === 'object' ? entry.changes : {};
  const createdAt = new Date(entry.createdAt);
  if (Number.isNaN(createdAt.getTime())) throw new Error('invalid_audit_created_at');
  return {
    id:entry.id,
    actor_id:systemActor || 'super_admin',
    action:auditIdentity.action,
    object_type:auditIdentity.objectType,
    object_id:entry.recordId,
    record_name:String(entry.recordName || entry.recordId || '').slice(0, 200),
    changed_fields:changedFields,
    before:Object.fromEntries(changedFields.map(field => [field, changes[field]?.before])),
    after:Object.fromEntries(changedFields.map(field => [field, changes[field]?.after])),
    reason:entry.reason ? String(entry.reason).slice(0, 500) : null,
    request_id:null,
    created_at:createdAt.toISOString(),
  };
}

module.exports = { AUDIT_ACTIONS, AUDIT_OBJECT_TYPES, buildSafeAuditEntry, validateAuditIdentity };
