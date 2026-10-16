import { beforeEach, describe, expect, it, vi } from 'vitest';

const cloud = vi.hoisted(() => ({
  ready: true,
  userId: 'wechat-a',
  callUserData: vi.fn(),
  isCloudSessionReady: vi.fn(() => cloud.ready),
  getCurrentUserId: vi.fn(() => cloud.ready ? cloud.userId : ''),
}));

vi.mock('../apps/miniprogram/services/cloudSession', () => ({
  callUserData: cloud.callUserData,
  isCloudSessionReady: cloud.isCloudSessionReady,
  getCurrentUserId: cloud.getCurrentUserId,
}));

import { getReminderRecords, initializeRemindersCloudSync, saveReminderPlans, saveReminderPlansWithAuthorization, syncReminderTarget } from '../apps/miniprogram/services/reminders';

const storage = new Map<string, unknown>();
const reminder = {
  id: 'reminder-1', editionId: 'edition-1', competitionName: '测试竞赛', taskName: '测试竞赛·报名截止提醒',
  eventType: 'registration_end' as const, eventLabel: '报名截止', targetAt: '2099-08-20T10:00:00.000Z',
  advanceKey: '1d', advanceLabel: '提前1天', offsetMs: 86400000, remindAt: '2099-08-19T10:00:00.000Z',
  authorizationStatus: 'not_requested' as const, deliveryStatus: 'pending' as const, scheduleChangeStatus: 'normal' as const,
  createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
};

beforeEach(() => {
  storage.clear();
  cloud.ready = true;
  cloud.userId = 'wechat-a';
  cloud.callUserData.mockReset();
  cloud.callUserData.mockImplementation(async (action: string) => action === 'listReminders' ? [] : { ok: true });
  (globalThis as any).wx = {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  };
});

describe('account-bound reminder data', () => {
  it('does not save a notification consent callback to a different account', async () => {
    let authorize: any;
    (wx as any).requestSubscribeMessage = (options: any) => { authorize = options.success; };
    const saving = saveReminderPlansWithAuthorization({ editionId: 'a-only', competitionName: '测试', eventType: 'registration_end', eventLabel: '报名截止', targetAt: reminder.targetAt, presets: [], customAt: reminder.remindAt }, 'template-id');
    const rejected = expect(saving).rejects.toThrow('账号已变更');
    cloud.userId = 'wechat-b';
    authorize({ 'template-id': 'accept' });
    await rejected;
    expect(getReminderRecords()).toEqual([]);
    expect(cloud.callUserData).not.toHaveBeenCalled();
  });

  it('preserves the absolute time chosen by the user when an event moves', () => {
    const custom = { ...reminder, advanceKey: 'custom' };
    storage.set('competition-reminders-v1:wechat-a', [custom]);
    const updated = syncReminderTarget(custom, '2099-08-30T10:00:00Z');
    expect(updated.remindAt).toBe(custom.remindAt);
    expect(updated.targetAt).toBe('2099-08-30T10:00:00Z');
  });
  it('shows zero before login and does not import unscoped device reminders', async () => {
    storage.set('competition-reminders-v1', [reminder]);
    cloud.ready = false;
    expect(getReminderRecords()).toEqual([]);
    expect(() => saveReminderPlans({ editionId: 'new', competitionName: '测试', eventType: 'registration_end', eventLabel: '报名截止', targetAt: reminder.targetAt, presets: ['1d'] })).toThrow('请先微信登录');

    cloud.ready = true;
    await initializeRemindersCloudSync();
    expect(getReminderRecords()).toEqual([]);
    expect(cloud.callUserData.mock.calls.some(([action]) => action === 'mergeReminders')).toBe(false);
  });

  it('shows each WeChat account only its own reminder cache', () => {
    storage.set('competition-reminders-v1:wechat-a', [reminder]);
    storage.set('competition-reminders-v1:wechat-b', [{ ...reminder, id: 'reminder-b', editionId: 'edition-b' }]);
    expect(getReminderRecords().map(item => item.editionId)).toEqual(['edition-1']);
    cloud.userId = 'wechat-b';
    expect(getReminderRecords().map(item => item.editionId)).toEqual(['edition-b']);
  });

  it('uploads only the current account local reminders in bounded batches', async () => {
    storage.set('competition-reminders-v1:wechat-a', Array.from({ length: 25 }, (_, index) => ({ ...reminder, id: `reminder-${index}`, editionId: `edition-${index}` })));
    storage.set('competition-reminders-v1:wechat-b', [{ ...reminder, id: 'other-account' }]);
    await initializeRemindersCloudSync();
    const batches = cloud.callUserData.mock.calls.filter(([action]) => action === 'mergeReminders').map(([, payload]) => payload.records.length);
    expect(batches).toEqual([10, 10, 5]);
  });
});
