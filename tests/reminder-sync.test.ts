import { beforeEach, describe, expect, it, vi } from 'vitest';

const cloud = vi.hoisted(() => ({
  ready: false,
  callUserData: vi.fn(),
  isCloudSessionReady: vi.fn(() => cloud.ready),
}));

vi.mock('../apps/miniprogram/services/cloudSession', () => ({
  callUserData: cloud.callUserData,
  isCloudSessionReady: cloud.isCloudSessionReady,
}));

import { getReminderRecords, initializeRemindersCloudSync, removeReminder, removeRemindersForEdition, saveReminderPlans, syncReminderTarget } from '../apps/miniprogram/services/reminders';

const storage = new Map<string, unknown>();
const reminder = {
  id:'reminder-1', editionId:'edition-1', competitionName:'测试竞赛', taskName:'测试竞赛·报名截止提醒',
  eventType:'registration_end' as const, eventLabel:'报名截止', targetAt:'2099-08-20T10:00:00.000Z',
  advanceKey:'1d', advanceLabel:'提前1天', offsetMs:86400000, remindAt:'2099-08-19T10:00:00.000Z',
  authorizationStatus:'not_requested' as const, deliveryStatus:'pending' as const, scheduleChangeStatus:'normal' as const,
  createdAt:'2026-08-20T00:00:00.000Z', updatedAt:'2026-08-20T00:00:00.000Z',
};

beforeEach(() => {
  storage.clear();
  cloud.ready = false;
  cloud.callUserData.mockReset();
  (globalThis as any).wx = {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  };
});

describe('reminder cloud synchronization', () => {
  it('does not resurrect a reminder deleted while offline', async () => {
    storage.set('competition-reminders-v1', [reminder]);
    removeReminder(reminder.id);
    cloud.callUserData.mockImplementation(async (action: string) => action === 'listReminders' ? [reminder] : { ok:true });

    await initializeRemindersCloudSync();

    expect(getReminderRecords()).toEqual([]);
    expect(cloud.callUserData).toHaveBeenCalledWith('removeReminder', { id:reminder.id });
    expect(storage.get('competition-reminder-deletions-v1')).toEqual([]);
  });

  it('keeps an edition deletion pending when cloud synchronization fails', async () => {
    storage.set('competition-reminders-v1', [reminder]);
    removeRemindersForEdition(reminder.editionId);
    cloud.callUserData.mockImplementation(async (action: string) => {
      if (action === 'listReminders') return [reminder];
      throw new Error('network unavailable');
    });

    await expect(initializeRemindersCloudSync()).rejects.toThrow('network unavailable');
    expect(getReminderRecords()).toEqual([]);
    expect(storage.get('competition-reminder-edition-deletions-v1')).toEqual([reminder.editionId]);
  });

  it('uploads a large local reminder set in bounded batches', async () => {
    const records = Array.from({ length:55 }, (_, index) => ({ ...reminder, id:`reminder-${index}`, editionId:`edition-${index}` }));
    storage.set('competition-reminders-v1', records);
    cloud.callUserData.mockImplementation(async (action: string) => action === 'listReminders' ? [] : { ok:true });

    await initializeRemindersCloudSync();

    const batches = cloud.callUserData.mock.calls.filter(([action]) => action === 'mergeReminders').map(([, payload]) => payload.records.length);
    expect(batches).toEqual([10, 10, 10, 10, 10, 5]);
  });

  it('preserves a reminder added while the initial cloud list is in flight', async () => {
    let releaseList!: (records: unknown[]) => void;
    const list = new Promise<unknown[]>(resolve => { releaseList = resolve; });
    cloud.ready = true;
    cloud.callUserData.mockImplementation(async (action: string) => action === 'listReminders' ? list : { ok:true });

    const syncing = initializeRemindersCloudSync();
    await Promise.resolve();
    saveReminderPlans({ editionId:'edition-new', competitionName:'测试竞赛', eventType:'registration_end', eventLabel:'报名截止', targetAt:'2099-08-20T10:00:00.000Z', presets:['1d'] });
    releaseList([]);
    await syncing;

    expect(getReminderRecords().map(item => item.editionId)).toEqual(['edition-new']);
    expect(cloud.callUserData.mock.calls.map(([action]) => action)).toEqual(['listReminders', 'replaceReminderEvent', 'mergeReminders']);
  });

  it('cancels a pending reminder even when the target timestamp did not change', () => {
    storage.set('competition-reminders-v1', [reminder]);
    const updated = syncReminderTarget(reminder, reminder.targetAt, 'cancelled');

    expect(updated.scheduleChangeStatus).toBe('cancelled');
    expect(updated.deliveryStatus).toBe('cancelled');
    expect(getReminderRecords()[0]).toMatchObject({ scheduleChangeStatus:'cancelled', deliveryStatus:'cancelled' });
  });
});
