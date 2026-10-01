const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const { validateFeedbackInput } = require('./feedbackValidation');
const { nextFeedbackRateState } = require('./feedbackRateLimit');
const { shouldDeleteCloudReminder, shouldPreserveCloudReminder } = require('./reminderWritePolicy');
const { normalizeReminderInput, normalizeReminderBatch, requireReminderEventType } = require('./reminderValidation');
const { normalizeFavoriteBatch, requireFavoriteFlag, requireFavoriteId } = require('./favoriteValidation');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const MAX_FAVORITES = 500;
const MAX_REMINDERS = 1000;
const MAX_WRITE_BATCH = 50;
const MAX_REMINDER_WRITE_BATCH = 10;
const MAX_REMINDERS_PER_EVENT = 8;
const MAX_EXISTING_EVENT_REMINDERS = 50;
const MAX_FEEDBACKS_PER_DAY = 20;
const MAX_FEEDBACK_LIST = 50;

async function currentUserId() {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) throw new Error('unauthenticated');
  const result = await db.collection('user_account').where({ openid: OPENID }).limit(1).get();
  if (!result.data.length) {
    // 2026-10-01 起登录、收藏、提醒都在腾讯云上海，只有纠错反馈仍在美国服务器（管理员在后台审核）。
    // 在上海新注册的用户第一次在这边提交反馈时，这边还没有账号：按同一个微信身份补建一个，不再报“账号不存在”。
    const now = new Date().toISOString();
    const created = await db.collection('user_account').add({ data:{ openid:OPENID, appid:null, unionid:null, status:'active', created_at:now, updated_at:now, last_login_at:now } });
    return created._id;
  }
  if (result.data[0].status !== 'active') throw new Error('user_account_disabled');
  return result.data[0]._id;
}

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`invalid_${field}`);
  return value.trim();
}

function requireRecordArray(value, max, field) {
  if (!Array.isArray(value)) throw new Error(`invalid_${field}`);
  if (value.length > max) throw new Error(`${field}_limit_exceeded`);
  return value;
}

function requireIsoDate(value, field) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid_${field}`);
  return date.toISOString();
}

function buildTaskName(competitionName, eventLabel, maxLength = 20) {
  const suffix = `${eventLabel}提醒`;
  const available = Math.max(1, maxLength - Array.from(suffix).length - 1);
  return `${Array.from(competitionName || '大学生竞赛').slice(0, available).join('')}·${suffix}`;
}

function favoriteToClient(item) {
  return { editionId: item.edition_id, createdAt: new Date(item.created_at).toISOString() };
}

// 只回传用户自己提交的内容和处理状态。
// 管理员的 review_note 属于内部备注，不对用户公开。
function feedbackToClient(item) {
  return {
    id:item.id,
    editionId:item.edition_id,
    competitionName:item.competition_name || '',
    category:item.category,
    content:item.content,
    evidenceUrl:item.evidence_url || '',
    status:item.status || 'pending_ai_review',
    createdAt:item.created_at,
    updatedAt:item.updated_at || item.created_at,
    resolvedAt:item.resolved_at || null,
  };
}

function reminderToDatabase(item, userId) {
  const normalized = normalizeReminderInput(item);
  return {
    id: normalized.id, user_id: userId,
    edition_id: normalized.editionId,
    competition_name: normalized.competitionName,
    task_name: normalized.taskName || buildTaskName(normalized.competitionName, normalized.eventLabel),
    event_type: normalized.eventType, event_label: normalized.eventLabel,
    target_at: normalized.targetAt, advance_key: normalized.advanceKey,
    advance_label: normalized.advanceLabel, offset_ms: normalized.offsetMs,
    remind_at: normalized.remindAt, authorization_status: normalized.authorizationStatus,
    delivery_status: normalized.deliveryStatus, schedule_change_status: normalized.scheduleChangeStatus,
    subscription_template_id: normalized.subscriptionTemplateId, retry_count:normalized.retryCount,
    last_error:normalized.lastError, created_at: normalized.createdAt, updated_at: normalized.updatedAt, data_version: 1,
  };
}

function reminderToClient(item) {
  return {
    id:item.id, editionId:item.edition_id, competitionName:item.competition_name || '大学生竞赛', taskName:item.task_name || buildTaskName(item.competition_name,item.event_label), eventType:item.event_type, eventLabel:item.event_label,
    targetAt:new Date(item.target_at).toISOString(), advanceKey:item.advance_key, advanceLabel:item.advance_label,
    offsetMs:item.offset_ms, remindAt:new Date(item.remind_at).toISOString(), authorizationStatus:item.authorization_status,
    deliveryStatus:item.delivery_status, scheduleChangeStatus:item.schedule_change_status,
    subscriptionTemplateId:item.subscription_template_id || undefined, retryCount:item.retry_count || 0, lastError:item.last_error || undefined,
    createdAt:new Date(item.created_at).toISOString(), updatedAt:new Date(item.updated_at).toISOString(),
  };
}

function isMissingDocument(error) {
  return error?.errCode === -1 || /not exist|not found/i.test(error?.message || '');
}

async function readTransactionDocument(transaction, id) {
  try {
    const result = await transaction.collection('reminder').doc(id).get();
    return result.data || null;
  } catch (error) {
    if (isMissingDocument(error)) return null;
    throw error;
  }
}

async function loadReminderDocumentsByIds(userId, ids) {
  if (!ids.length) return [];
  const result = await db.collection('reminder').where({ user_id:userId, id:db.command.in(ids) }).limit(ids.length).get();
  return result.data || [];
}

async function upsertRemindersAtomically(records) {
  const existing = await loadReminderDocumentsByIds(records[0]?.user_id, records.map(item => item.id));
  const existingById = new Map(existing.map(item => [item.id, item]));
  return db.runTransaction(async transaction => {
    let preserved = 0;
    for (const record of records) {
      const documentId = existingById.get(record.id)?._id || record.id;
      const current = await readTransactionDocument(transaction, documentId);
      if (current && shouldPreserveCloudReminder(current)) {
        preserved += 1;
        continue;
      }
      await transaction.collection('reminder').doc(documentId).set({ data:record });
    }
    return { preserved };
  });
}

async function handle(action, event, userId) {
  if (action === 'submitFeedback') {
    const { editionId, competitionName, category, content, evidenceUrl } = validateFeedbackInput(event);
    const nowDate = new Date();
    const now = nowDate.toISOString();
    const record = {
      id:`feedback-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`,
      user_id:userId, edition_id:editionId, competition_name:competitionName,
      category, content, evidence_url:evidenceUrl || null,
      status:'pending_ai_review', spot_check_status:'not_checked',
      created_at:now, updated_at:now, data_version:1,
    };
    await db.runTransaction(async transaction => {
      const accountRef = transaction.collection('user_account').doc(userId);
      const accountResult = await accountRef.get();
      const account = accountResult.data || {};
      if (account.status !== 'active') throw new Error('user_account_disabled');
      await accountRef.update({ data:nextFeedbackRateState(account, nowDate, MAX_FEEDBACKS_PER_DAY) });
      await transaction.collection('feedback').doc(record.id).set({ data:record });
    });
    return { id:record.id, status:record.status, createdAt:record.created_at };
  }
  if (action === 'listFeedback') {
    const result = await db.collection('feedback').where({ user_id:userId })
      .orderBy('created_at', 'desc').limit(MAX_FEEDBACK_LIST).get();
    return result.data.map(feedbackToClient);
  }
  if (action === 'listFavorites') {
    const result = await db.collection('favorite').where({ user_id: userId }).limit(MAX_FAVORITES).get();
    return result.data.map(favoriteToClient);
  }
  if (action === 'mergeFavorites') {
    const records = requireRecordArray(event.records, MAX_WRITE_BATCH, 'favorites');
    const normalizedRecords = normalizeFavoriteBatch(records);
    await Promise.all(normalizedRecords.map(async item => {
      const editionId = item.editionId;
      const existing = await db.collection('favorite').where({ user_id:userId, edition_id:editionId }).limit(1).get();
      if (!existing.data.length) await db.collection('favorite').add({ data:{ user_id:userId, edition_id:editionId, created_at:item.createdAt, updated_at:new Date().toISOString() } });
    }));
    return { merged: records.length };
  }
  if (action === 'setFavorite') {
    const editionId = requireFavoriteId(event.editionId);
    const favorited = requireFavoriteFlag(event.favorited);
    const existing = await db.collection('favorite').where({ user_id:userId, edition_id:editionId }).get();
    if (favorited) {
      if (!existing.data.length) await db.collection('favorite').add({ data:{ user_id:userId, edition_id:editionId, created_at:requireIsoDate(event.createdAt || Date.now(), 'created_at'), updated_at:new Date().toISOString() } });
    } else {
      for (const item of existing.data) await db.collection('favorite').doc(item._id).remove();
    }
    return { favorited };
  }
  if (action === 'listReminders') {
    const result = await db.collection('reminder').where({ user_id:userId }).limit(MAX_REMINDERS).get();
    return result.data.map(reminderToClient);
  }
  if (action === 'mergeReminders' || action === 'upsertReminders') {
    const records = requireRecordArray(event.records, MAX_REMINDER_WRITE_BATCH, 'reminders');
    const databaseRecords = normalizeReminderBatch(records).map(item => reminderToDatabase(item, userId));
    const result = await upsertRemindersAtomically(databaseRecords);
    return { merged:records.length, preserved:result.preserved };
  }
  if (action === 'replaceReminderEvent') {
    const editionId = requireString(event.editionId, 'edition_id');
    const eventType = requireReminderEventType(event.eventType);
    const records = requireRecordArray(event.records, MAX_REMINDERS_PER_EVENT, 'reminders');
    const databaseRecords = normalizeReminderBatch(records, { editionId, eventType }).map(item => reminderToDatabase(item, userId));
    const keepIds = new Set(databaseRecords.map(item=>item.id));
    const existing = await db.collection('reminder').where({ user_id:userId, edition_id:editionId, event_type:eventType }).limit(MAX_EXISTING_EVENT_REMINDERS + 1).get();
    if (existing.data.length > MAX_EXISTING_EVENT_REMINDERS) throw new Error('reminder_scope_too_large');
    const existingById = new Map(existing.data.map(item => [item.id, item]));
    const result = await db.runTransaction(async transaction => {
      const currentById = new Map();
      for (const item of existing.data) {
        const current = await readTransactionDocument(transaction, item._id);
        if (current) currentById.set(current.id, { ...current, _id:item._id });
      }
      let removed = 0;
      let preserved = 0;
      for (const current of currentById.values()) {
        if (keepIds.has(current.id)) continue;
        if (!shouldDeleteCloudReminder(current, keepIds)) {
          preserved += 1;
          continue;
        }
        await transaction.collection('reminder').doc(current._id).remove();
        removed += 1;
      }
      for (const record of databaseRecords) {
        const current = currentById.get(record.id);
        if (current && shouldPreserveCloudReminder(current)) {
          preserved += 1;
          continue;
        }
        const documentId = current?._id || existingById.get(record.id)?._id || record.id;
        await transaction.collection('reminder').doc(documentId).set({ data:record });
      }
      return { removed, preserved };
    });
    return { saved:records.length, removed:result.removed, preserved:result.preserved };
  }
  if (action === 'removeReminder') {
    const id = requireString(event.id, 'reminder_id');
    const existing = await db.collection('reminder').where({ user_id:userId, id }).limit(1).get();
    await Promise.all(existing.data.map(item => db.collection('reminder').doc(item._id).remove()));
    return { removed:existing.data.length };
  }
  if (action === 'removeRemindersForEdition') {
    const editionId = requireString(event.editionId, 'edition_id');
    const existing = await db.collection('reminder').where({ user_id:userId, edition_id:editionId }).limit(MAX_REMINDERS).get();
    await Promise.all(existing.data.map(item => db.collection('reminder').doc(item._id).remove()));
    return { removed:existing.data.length };
  }
  throw new Error('unsupported_action');
}

exports.main = async event => {
  try {
    const userId = await currentUserId();
    const data = await handle(event.action, event, userId);
    return { ok:true, data };
  } catch (error) {
    console.error('userData failed', { action:event.action, error });
    return { ok:false, message:error instanceof Error ? error.message : 'user_data_failed' };
  }
};
