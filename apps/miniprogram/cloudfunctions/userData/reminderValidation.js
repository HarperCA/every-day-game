const EVENT_TYPES = new Set(['registration_start', 'registration_end']);
const ADVANCE_KEYS = new Set(['1d', '3d', '5d', '7d', '15d', '1m', '3m', 'custom']);
const AUTHORIZATION_STATUSES = new Set(['not_requested', 'accepted', 'rejected', 'unavailable']);
const DELIVERY_STATUSES = new Set(['pending', 'queued', 'failed', 'manual_required', 'expired', 'sent', 'cancelled']);
const SCHEDULE_CHANGE_STATUSES = new Set(['normal', 'time_updated', 'postponed', 'cancelled']);

function requireString(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`invalid_${field}`);
  const normalized = value.trim();
  if (Array.from(normalized).length > maxLength) throw new Error(`${field}_too_long`);
  return normalized;
}

function requireDocumentId(value, field) {
  const normalized = requireString(value, field, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) throw new Error(`invalid_${field}`);
  return normalized;
}

function requireEnum(value, allowed, field) {
  const normalized = requireString(value, field, 64);
  if (!allowed.has(normalized)) throw new Error(`invalid_${field}`);
  return normalized;
}

function requireIsoDate(value, field) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid_${field}`);
  return date;
}

function optionalString(value, field, maxLength) {
  if (value === undefined || value === null || value === '') return null;
  return requireString(value, field, maxLength);
}

function normalizeReminderInput(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('invalid_reminder');
  const targetAt = requireIsoDate(item.targetAt, 'target_at');
  const remindAt = requireIsoDate(item.remindAt, 'remind_at');
  if (remindAt.getTime() >= targetAt.getTime()) throw new Error('invalid_remind_at');
  const retryCount = item.retryCount === undefined ? 0 : item.retryCount;
  if (!Number.isInteger(retryCount) || retryCount < 0 || retryCount > 100) throw new Error('invalid_retry_count');

  return {
    id: requireDocumentId(item.id, 'reminder_id'),
    editionId: requireDocumentId(item.editionId, 'edition_id'),
    competitionName: requireString(item.competitionName || '大学生竞赛', 'competition_name', 200),
    taskName: optionalString(item.taskName, 'task_name', 20),
    eventType: requireEnum(item.eventType, EVENT_TYPES, 'event_type'),
    eventLabel: requireString(item.eventLabel, 'event_label', 40),
    targetAt: targetAt.toISOString(),
    advanceKey: requireEnum(item.advanceKey, ADVANCE_KEYS, 'advance_key'),
    advanceLabel: requireString(item.advanceLabel, 'advance_label', 40),
    offsetMs: targetAt.getTime() - remindAt.getTime(),
    remindAt: remindAt.toISOString(),
    authorizationStatus: requireEnum(item.authorizationStatus, AUTHORIZATION_STATUSES, 'authorization_status'),
    deliveryStatus: requireEnum(item.deliveryStatus, DELIVERY_STATUSES, 'delivery_status'),
    scheduleChangeStatus: requireEnum(item.scheduleChangeStatus, SCHEDULE_CHANGE_STATUSES, 'schedule_change_status'),
    subscriptionTemplateId: optionalString(item.subscriptionTemplateId, 'subscription_template_id', 200),
    retryCount,
    lastError: optionalString(item.lastError, 'last_error', 500),
    createdAt: requireIsoDate(item.createdAt, 'created_at').toISOString(),
    updatedAt: requireIsoDate(item.updatedAt, 'updated_at').toISOString(),
  };
}

function requireReminderEventType(value) {
  return requireEnum(value, EVENT_TYPES, 'event_type');
}

function normalizeReminderBatch(records, scope = null) {
  const normalized = records.map(normalizeReminderInput);
  const ids = new Set();
  for (const item of normalized) {
    if (ids.has(item.id)) throw new Error('duplicate_reminder_id');
    ids.add(item.id);
    if (scope && (item.editionId !== scope.editionId || item.eventType !== scope.eventType)) throw new Error('reminder_scope_mismatch');
  }
  return normalized;
}

module.exports = { normalizeReminderInput, normalizeReminderBatch, requireReminderEventType };
