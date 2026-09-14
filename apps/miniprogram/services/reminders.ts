import { callUserData, isCloudSessionReady } from './cloudSession';

const STORAGE_KEY = 'competition-reminders-v1';
const DELETED_IDS_KEY = 'competition-reminder-deletions-v1';
const DELETED_EDITIONS_KEY = 'competition-reminder-edition-deletions-v1';
let cloudWriteQueue: Promise<unknown> = Promise.resolve();

export type ReminderEventType = 'registration_start' | 'registration_end';
export type AuthorizationStatus = 'not_requested' | 'accepted' | 'rejected' | 'unavailable';
export type ScheduleChangeStatus = 'normal' | 'time_updated' | 'postponed' | 'cancelled';

export interface ReminderRecord {
  id: string;
  editionId: string;
  competitionName: string;
  taskName: string;
  eventType: ReminderEventType;
  eventLabel: string;
  targetAt: string;
  advanceKey: string;
  advanceLabel: string;
  offsetMs: number;
  remindAt: string;
  authorizationStatus: AuthorizationStatus;
  deliveryStatus: 'pending' | 'queued' | 'failed' | 'manual_required' | 'expired' | 'sent' | 'cancelled';
  scheduleChangeStatus: ScheduleChangeStatus;
  subscriptionTemplateId?: string;
  retryCount?: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export const ADVANCE_OPTIONS = [
  { key: '1d', label: '提前1天', days: 1 },
  { key: '3d', label: '提前3天', days: 3 },
  { key: '5d', label: '提前5天', days: 5 },
  { key: '7d', label: '提前7天', days: 7 },
  { key: '15d', label: '提前15天', days: 15 },
  { key: '1m', label: '提前1个月', months: 1 },
  { key: '3m', label: '提前3个月', months: 3 },
];

export function buildReminderTaskName(competitionName: string, eventLabel: string, maxLength = 20): string {
  const suffix = `${eventLabel}提醒`;
  const suffixLength = Array.from(suffix).length;
  const available = Math.max(1, maxLength - suffixLength - 1);
  const prefix = Array.from(competitionName.trim() || '大学生竞赛').slice(0, available).join('');
  return `${prefix}·${suffix}`;
}

function readRecords(): ReminderRecord[] {
  try {
    const value = wx.getStorageSync(STORAGE_KEY);
    return Array.isArray(value) ? value.filter((item: any) => item?.id && item?.editionId && item?.remindAt).map((item: any) => ({
      ...item,
      competitionName:item.competitionName || '大学生竞赛',
      taskName:item.taskName || buildReminderTaskName(item.competitionName || '大学生竞赛', item.eventLabel || '报名'),
    })) : [];
  } catch (_error) {
    return [];
  }
}

function writeRecords(records: ReminderRecord[]) {
  wx.setStorageSync(STORAGE_KEY, records);
}

function readStringList(key: string): string[] {
  try {
    const value = wx.getStorageSync(key);
    return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item) : [];
  } catch (_error) { return []; }
}

function writeStringList(key: string, values: string[]) {
  wx.setStorageSync(key, Array.from(new Set(values)));
}

function markPendingDeletion(key: string, value: string) {
  writeStringList(key, [...readStringList(key), value]);
}

function clearPendingDeletion(key: string, value: string) {
  writeStringList(key, readStringList(key).filter(item => item !== value));
}

function runReminderCloud<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const task = cloudWriteQueue.catch(() => undefined).then(() => callUserData<T>(action, payload));
  cloudWriteQueue = task.catch(() => undefined);
  return task;
}

function queueCloud(action: string, payload: Record<string, unknown>, onSuccess?: () => void) {
  if (!isCloudSessionReady()) return;
  runReminderCloud(action, payload)
    .then(() => onSuccess?.())
    .catch((error: unknown) => console.error('提醒云同步失败', error));
}

export async function initializeRemindersCloudSync(): Promise<void> {
  const remote = await runReminderCloud<ReminderRecord[]>('listReminders');
  const local = readRecords();
  const deletedIds = new Set(readStringList(DELETED_IDS_KEY));
  const deletedEditions = new Set(readStringList(DELETED_EDITIONS_KEY));
  const merged = new Map<string, ReminderRecord>();
  for (const item of remote.filter(item => !deletedIds.has(item.id) && !deletedEditions.has(item.editionId))) {
    const previous = merged.get(item.id);
    if (!previous || item.updatedAt > previous.updatedAt) merged.set(item.id, item);
  }
  for (const item of local.filter(item => !deletedIds.has(item.id))) {
    const previous = merged.get(item.id);
    if (!previous || item.updatedAt > previous.updatedAt) merged.set(item.id, item);
  }
  const records = [...merged.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  writeRecords(records);
  for (const id of deletedIds) await runReminderCloud('removeReminder', { id });
  for (const editionId of deletedEditions) await runReminderCloud('removeRemindersForEdition', { editionId });
  for (let index = 0; index < records.length; index += 10) {
    await runReminderCloud('mergeReminders', { records:records.slice(index, index + 10) });
  }
  writeStringList(DELETED_IDS_KEY, []);
  writeStringList(DELETED_EDITIONS_KEY, []);
}

export function calculatePresetReminder(targetAt: string, option: { days?: number; months?: number }): Date {
  const value = new Date(targetAt);
  if (option.months) {
    const originalDay = value.getDate();
    value.setDate(1);
    value.setMonth(value.getMonth() - option.months);
    const lastDay = new Date(value.getFullYear(), value.getMonth() + 1, 0).getDate();
    value.setDate(Math.min(originalDay, lastDay));
  }
  if (option.days) value.setDate(value.getDate() - option.days);
  return value;
}

export function getReminderRecords(): ReminderRecord[] {
  const now = Date.now();
  return readRecords().map(item => ({ ...item, deliveryStatus: item.deliveryStatus === 'pending' && new Date(item.remindAt).getTime() <= now ? 'expired' : item.deliveryStatus }));
}

export function getRemindersForEdition(editionId: string): ReminderRecord[] {
  return getReminderRecords().filter(item => item.editionId === editionId);
}

export function saveReminderPlans(input: {
  editionId: string;
  competitionName: string;
  eventType: ReminderEventType;
  eventLabel: string;
  targetAt: string;
  presets: string[];
  customAt?: string;
}): ReminderRecord[] {
  const now = new Date();
  const target = new Date(input.targetAt);
  if (Number.isNaN(target.getTime()) || target <= now) throw new Error('目标事件时间已经过去或尚未公布');
  const existing = readRecords();
  const preserved = existing.filter(item => !(item.editionId === input.editionId && item.eventType === input.eventType && item.deliveryStatus !== 'sent'));
  const previousByKey = new Map(existing.filter(item => item.editionId === input.editionId && item.eventType === input.eventType).map(item => [item.advanceKey, item]));
  const createdAt = new Date().toISOString();
  const plans: ReminderRecord[] = [];
  for (const key of input.presets) {
    const option = ADVANCE_OPTIONS.find(item => item.key === key);
    if (!option) continue;
    const remindAt = calculatePresetReminder(input.targetAt, option);
    if (remindAt <= now) continue;
    const previous = previousByKey.get(key);
    plans.push({
      id: previous?.id || `reminder-${input.editionId}-${input.eventType}-${key}-${Date.now()}`,
      editionId: input.editionId, competitionName:input.competitionName, taskName:buildReminderTaskName(input.competitionName,input.eventLabel), eventType: input.eventType, eventLabel: input.eventLabel,
      targetAt: input.targetAt, advanceKey: key, advanceLabel: option.label,
      offsetMs: target.getTime() - remindAt.getTime(), remindAt: remindAt.toISOString(),
      authorizationStatus: previous?.authorizationStatus || 'not_requested', deliveryStatus: 'pending',
      scheduleChangeStatus: 'normal', createdAt: previous?.createdAt || createdAt, updatedAt: createdAt,
    });
  }
  if (input.customAt) {
    const custom = new Date(input.customAt);
    if (custom <= now) throw new Error('自定义提醒时间必须晚于现在');
    if (custom >= target) throw new Error('自定义提醒时间必须早于目标事件');
    const previous = previousByKey.get('custom');
    plans.push({
      id: previous?.id || `reminder-${input.editionId}-${input.eventType}-custom-${Date.now()}`,
      editionId: input.editionId, competitionName:input.competitionName, taskName:buildReminderTaskName(input.competitionName,input.eventLabel), eventType: input.eventType, eventLabel: input.eventLabel,
      targetAt: input.targetAt, advanceKey: 'custom', advanceLabel: '自定义',
      offsetMs: target.getTime() - custom.getTime(), remindAt: custom.toISOString(),
      authorizationStatus: previous?.authorizationStatus || 'not_requested', deliveryStatus: 'pending',
      scheduleChangeStatus: 'normal', createdAt: previous?.createdAt || createdAt, updatedAt: createdAt,
    });
  }
  if (!plans.length) throw new Error('请选择至少一个尚未过去的提醒时间');
  writeRecords([...plans, ...preserved]);
  queueCloud('replaceReminderEvent', { editionId:input.editionId, eventType:input.eventType, records:plans });
  return plans;
}

export function updateAuthorization(ids: string[], status: AuthorizationStatus) {
  const now = new Date().toISOString();
  const records = readRecords().map(item => ids.includes(item.id) ? {
    ...item,
    authorizationStatus:status,
    ...(status === 'accepted' && item.deliveryStatus === 'manual_required' ? { deliveryStatus:'pending' as const, retryCount:0, lastError:undefined } : {}),
    updatedAt:now,
  } : item);
  writeRecords(records);
  queueCloud('upsertReminders', { records:records.filter(item=>ids.includes(item.id)) });
}

export function applyReminderAuthorization(plans: ReminderRecord[], status: AuthorizationStatus, templateId: string) {
  if (!plans.length) return;
  const planIds = new Set(plans.map(item=>item.id));
  const current = readRecords();
  let selectedId = '';
  if (status === 'accepted') {
    selectedId = [...plans].filter(item=>item.authorizationStatus !== 'accepted').sort((a,b)=>a.remindAt.localeCompare(b.remindAt))[0]?.id || '';
  }
  const now = new Date().toISOString();
  const updated = current.map(item => {
    if (!planIds.has(item.id)) return item;
    if (status === 'accepted') {
      return item.id === selectedId ? { ...item, authorizationStatus:'accepted' as const, subscriptionTemplateId:templateId, updatedAt:now } : item;
    }
    return item.authorizationStatus === 'accepted' ? item : { ...item, authorizationStatus:status, updatedAt:now };
  });
  writeRecords(updated);
  queueCloud('upsertReminders', { records:updated.filter(item=>planIds.has(item.id)) });
}

export function requestReminderAuthorization(templateId: string): Promise<AuthorizationStatus> {
  if (!templateId || typeof wx.requestSubscribeMessage !== 'function') return Promise.resolve('unavailable');
  return new Promise(resolve => {
    wx.requestSubscribeMessage({
      tmplIds: [templateId],
      success: (result: Record<string, string>) => resolve(result[templateId] === 'accept' ? 'accepted' : 'rejected'),
      fail: () => resolve('rejected'),
    });
  });
}

export function removeReminder(id: string) {
  writeRecords(readRecords().filter(item => item.id !== id));
  markPendingDeletion(DELETED_IDS_KEY, id);
  queueCloud('removeReminder', { id }, () => clearPendingDeletion(DELETED_IDS_KEY, id));
}

export function removeRemindersForEdition(editionId: string) {
  writeRecords(readRecords().filter(item => item.editionId !== editionId));
  markPendingDeletion(DELETED_EDITIONS_KEY, editionId);
  queueCloud('removeRemindersForEdition', { editionId }, () => clearPendingDeletion(DELETED_EDITIONS_KEY, editionId));
}

export function syncReminderTarget(record: ReminderRecord, targetAt: string, changeStatus: ScheduleChangeStatus = 'time_updated'): ReminderRecord {
  if (record.deliveryStatus !== 'pending' || (record.targetAt === targetAt && record.scheduleChangeStatus === changeStatus)) return record;
  const target = new Date(targetAt);
  if (Number.isNaN(target.getTime())) return record;
  const remindAt = new Date(target.getTime() - record.offsetMs);
  const updated: ReminderRecord = {
    ...record,
    targetAt,
    remindAt:remindAt.toISOString(),
    scheduleChangeStatus:changeStatus,
    deliveryStatus:changeStatus === 'cancelled' ? 'cancelled' : record.deliveryStatus,
    updatedAt:new Date().toISOString(),
  };
  writeRecords(readRecords().map(item => item.id === record.id ? updated : item));
  queueCloud('upsertReminders', { records:[updated] });
  return updated;
}
