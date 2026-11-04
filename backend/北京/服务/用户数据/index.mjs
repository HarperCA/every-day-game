// 用户数据：搬自上海云函数 userData（2026-11-02），去掉云函数的兼容外壳。说明见同目录 README.md。
// 动作、校验（*.js 原样搬来）、交回的格式都和上海一样；存取全部改调副数据库的工具（用户.*、收藏.*、提醒.*、偏好.*、纠错.*、意见反馈.*）。改了三处：
//   身份：上海用 cloud.getWXContext()；北京由入口校验令牌后把 openid 交进来，这里按 openid 找账号（请求里自己写的 openid 不认）
//   收藏：上海挂届次；北京挂比赛（2026-11-01 定）。小程序照旧传届次编号，按主数据库换成比赛存；列出时交回这个比赛最新的一届
//   纠错限频：上海把计数存在账号上；北京数这个人最近 24 小时交了几条，规则一样（每人每天 20 条）
// 不再把快到期的提醒推给美国（上海的 reminderPush）：存好后交给北京自己的发提醒排计划（环境里的 排提醒，即 发提醒 的 排上）。
//
//   handle({ action, ...参数 }, { 用户库, 主库, openid, now, 排提醒 }) → { ok: true, data } 或 { ok: false, message }
import { createRequire } from 'node:module';
import { 公开 } from '../../主数据库/index.mjs';
import { 用户, 收藏, 提醒, 偏好, 纠错, 意见反馈 } from '../../副数据库/index.mjs';

const require = createRequire(import.meta.url);
const { validateFeedbackInput } = require('./feedbackValidation.js');
const { shouldDeleteCloudReminder, shouldPreserveCloudReminder } = require('./reminderWritePolicy.js');
const { normalizeReminderInput, normalizeReminderBatch, requireReminderEventType } = require('./reminderValidation.js');
const { normalizeFavoriteBatch, requireFavoriteFlag, requireFavoriteId } = require('./favoriteValidation.js');
const { normalizePreferenceInput } = require('./preferenceValidation.js');
const 意见反馈规则 = require('./generalFeedback.js');

const MAX_FAVORITES = 500;
const MAX_REMINDERS = 1000;
const MAX_WRITE_BATCH = 50;
const MAX_REMINDER_WRITE_BATCH = 10;
const MAX_REMINDERS_PER_EVENT = 8;
const MAX_EXISTING_EVENT_REMINDERS = 50;
const MAX_FEEDBACKS_PER_DAY = 20;
const MAX_FEEDBACK_LIST = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---- 搬自上海 index.js ----
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

// 只回传用户自己提交的内容和处理状态。管理员的备注属于内部备注，不对用户公开。
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

function reminderToDatabase(item) {
  const normalized = normalizeReminderInput(item);
  return {
    id: normalized.id,
    edition_id: normalized.editionId,
    competition_name: normalized.competitionName,
    task_name: normalized.taskName || buildTaskName(normalized.competitionName, normalized.eventLabel),
    event_type: normalized.eventType, event_label: normalized.eventLabel,
    target_at: normalized.targetAt, advance_key: normalized.advanceKey,
    advance_label: normalized.advanceLabel, offset_ms: normalized.offsetMs,
    remind_at: normalized.remindAt, authorization_status: normalized.authorizationStatus,
    delivery_status: normalized.deliveryStatus, schedule_change_status: normalized.scheduleChangeStatus,
    subscription_template_id: normalized.subscriptionTemplateId, retry_count:normalized.retryCount,
    last_error:normalized.lastError,
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

function preferenceToClient(item) {
  if (!item) return null;
  return { profession:item.profession || '', categories:item.categories || [], province:item.province || '',
    surveyStatus:item.survey_status || 'completed', dontShowAgain:item.dont_show_again === true, updatedAt:item.updated_at || '' };
}

// ---- 北京改的 ----
function 当前用户(用户库, openid) {
  if (!openid) throw new Error('unauthenticated');
  const 账号 = 用户.按openid(用户库, openid);
  if (!账号) throw new Error('unauthenticated');
  if (账号.status !== 'active') throw new Error('user_account_disabled');
  return 账号.id;
}

// 收藏挂比赛：届次编号换成比赛编号；主数据库里没有这一届（没公开、已下架）就收藏不了
function 比赛编号(主库, editionId) {
  const 届 = 公开.届次(主库, editionId);
  if (!届) throw new Error('edition_not_found');
  return 届.competition_id;
}

// 比赛最新的一届：报名截止（没有就报名开始）最晚的那届
function 最新一届(主库, competitionId) {
  const 时间 = e => String(e.registration_end || e.registration_start || '');
  return 公开.比赛的届次(主库, competitionId).sort((a, b) => 时间(b).localeCompare(时间(a)) || b.id.localeCompare(a.id))[0] || null;
}

// 已经发出、排队中的不覆盖（上海的 reminderWritePolicy）
function 存提醒们(用户库, userId, records, now) {
  let preserved = 0;
  for (const record of records) {
    const current = 用户库.get('reminder', record.id)?.data;
    if (current && shouldPreserveCloudReminder(current)) { preserved += 1; continue; }
    提醒.保存(用户库, userId, record, { now });
  }
  return preserved;
}

async function 做(action, event, { 用户库, 主库, userId, now, 排提醒 }) {
  // 存好的提醒交给发提醒排计划（两小时内到期的才排上，其余每小时对账）；排计划出错不影响保存
  const 交去排 = ids => { try { 排提醒?.(ids.map(id => 用户库.get('reminder', id)?.data).filter(Boolean)); } catch (error) { console.error('[用户数据] 排提醒失败', error?.message); } };
  if (action === 'submitGeneralFeedback') {
    const normalized = 意见反馈规则.validateSubmission(event);
    const record = 意见反馈.提交(用户库, userId, { type: normalized.type, content: normalized.content, contact: normalized.contact, app_version: normalized.appVersion }, { now });
    return { feedback: 意见反馈规则.toClient(record) };
  }
  if (action === 'listGeneralFeedback') {
    const page = Math.max(1, Math.min(10000, Math.floor(Number(event.page) || 1)));
    const pageSize = Math.max(1, Math.min(50, Math.floor(Number(event.pageSize) || 20)));
    const 全部 = 意见反馈.列出(用户库, userId);
    return { items: 全部.slice((page - 1) * pageSize, page * pageSize).map(意见反馈规则.toClient), total: 全部.length, hasMore: page * pageSize < 全部.length };
  }
  if (action === 'submitFeedback') {
    const { editionId, competitionName, category, content, evidenceUrl } = validateFeedbackInput(event);
    const 近一天 = 纠错.列出(用户库, userId).filter(f => Date.parse(f.created_at) > now.getTime() - DAY_MS).length;
    if (近一天 >= MAX_FEEDBACKS_PER_DAY) throw new Error('feedback_rate_limit_exceeded');
    const record = 纠错.提交(用户库, userId, { edition_id: editionId, competition_name: competitionName, category, content, evidence_url: evidenceUrl || null }, { now });
    return { id: record.id, status: record.status, createdAt: record.created_at };
  }
  // 偏好问卷（专业、比赛大类、省份）：每个账号一条，换手机登录能带上
  if (action === 'getPreferences') return preferenceToClient(偏好.读取(用户库, userId));
  if (action === 'savePreferences') {
    const item = normalizePreferenceInput(event.preferences || {});
    const saved = 偏好.保存(用户库, userId, { profession: item.profession, categories: item.categories, province: item.province,
      survey_status: item.surveyStatus, dont_show_again: item.dontShowAgain }, { now });
    return preferenceToClient(saved);
  }
  if (action === 'listFeedback') return 纠错.列出(用户库, userId).slice(0, MAX_FEEDBACK_LIST).map(feedbackToClient);
  if (action === 'listFavorites') {
    return 收藏.列出(用户库, userId).slice(0, MAX_FAVORITES)
      .map(f => ({ 届: 最新一届(主库, f.competition_id), createdAt: new Date(f.created_at).toISOString() }))
      .filter(x => x.届)
      .map(x => ({ editionId: x.届.id, createdAt: x.createdAt }));
  }
  if (action === 'mergeFavorites') {
    const records = requireRecordArray(event.records, MAX_WRITE_BATCH, 'favorites');
    const normalizedRecords = normalizeFavoriteBatch(records);
    const 换好 = normalizedRecords.map(item => ({ 比赛: 比赛编号(主库, item.editionId), createdAt: item.createdAt }));
    for (const x of 换好) 收藏.加(用户库, userId, x.比赛, { now: new Date(x.createdAt) });
    return { merged: records.length };
  }
  if (action === 'setFavorite') {
    const editionId = requireFavoriteId(event.editionId);
    const favorited = requireFavoriteFlag(event.favorited);
    const 比赛 = 比赛编号(主库, editionId);
    if (favorited) 收藏.加(用户库, userId, 比赛, { now: new Date(requireIsoDate(event.createdAt || now, 'created_at')) });
    else 收藏.取消(用户库, userId, 比赛);
    return { favorited };
  }
  if (action === 'listReminders') return 提醒.列出(用户库, userId).slice(0, MAX_REMINDERS).map(reminderToClient);
  if (action === 'mergeReminders' || action === 'upsertReminders') {
    const records = requireRecordArray(event.records, MAX_REMINDER_WRITE_BATCH, 'reminders');
    const databaseRecords = normalizeReminderBatch(records).map(reminderToDatabase);
    const preserved = 用户库.transaction(() => 存提醒们(用户库, userId, databaseRecords, now));
    交去排(databaseRecords.map(r => r.id));
    return { merged: records.length, preserved };
  }
  if (action === 'replaceReminderEvent') {
    const editionId = requireString(event.editionId, 'edition_id');
    const eventType = requireReminderEventType(event.eventType);
    const records = requireRecordArray(event.records, MAX_REMINDERS_PER_EVENT, 'reminders');
    const databaseRecords = normalizeReminderBatch(records, { editionId, eventType }).map(reminderToDatabase);
    const keepIds = new Set(databaseRecords.map(item => item.id));
    const existing = 提醒.列出(用户库, userId).filter(r => r.edition_id === editionId && r.event_type === eventType);
    if (existing.length > MAX_EXISTING_EVENT_REMINDERS) throw new Error('reminder_scope_too_large');
    const 结果 = 用户库.transaction(() => {
      let removed = 0;
      let preserved = 0;
      for (const current of existing) {
        if (keepIds.has(current.id)) continue;
        if (!shouldDeleteCloudReminder(current, keepIds)) { preserved += 1; continue; }
        removed += 提醒.删除(用户库, userId, current.id).删了;
      }
      preserved += 存提醒们(用户库, userId, databaseRecords, now);
      return { saved: records.length, removed, preserved };
    });
    交去排(databaseRecords.map(r => r.id));
    return 结果;
  }
  if (action === 'removeReminder') {
    const id = requireString(event.id, 'reminder_id');
    return { removed: 提醒.删除(用户库, userId, id).删了 };
  }
  if (action === 'removeRemindersForEdition') {
    const editionId = requireString(event.editionId, 'edition_id');
    return { removed: 提醒.删届次的(用户库, userId, editionId).删了 };
  }
  throw new Error('unsupported_action');
}

export async function handle(request = {}, { 用户库, 主库, openid, now = () => new Date(), 排提醒 } = {}) {
  const { action, ...event } = request;
  try {
    const userId = 当前用户(用户库, openid);
    return { ok: true, data: await 做(action, event, { 用户库, 主库, userId, now: now(), 排提醒 }) };
  } catch (error) {
    if (!['unauthenticated', 'user_account_disabled', 'unsupported_action'].includes(error?.message)) console.error('[用户数据] 出错', { action, error: error?.message });
    return { ok: false, message: error instanceof Error ? error.message : 'user_data_failed' };
  }
}
