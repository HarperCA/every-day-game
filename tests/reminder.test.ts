import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../apps/miniprogram/services/cloudSession', () => ({
  callUserData: vi.fn(),
  isCloudSessionReady: () => true,
  getCurrentUserId: () => 'test-user',
}));
import { applyReminderAuthorization, buildReminderTaskName, calculatePresetReminder, getReminderRecords, saveReminderPlans } from '../apps/miniprogram/services/reminders';

const storage = new Map<string, unknown>();

beforeEach(() => {
  storage.clear();
  (globalThis as any).wx = {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => { storage.set(key, value); },
  };
});

describe('reminder rules', () => {
  it('calculates preset reminders before the target event', () => {
    const target = '2099-08-20T10:00:00+08:00';
    expect(calculatePresetReminder(target, { days: 7 }).getTime()).toBeLessThan(new Date(target).getTime());
    expect(calculatePresetReminder(target, { months: 3 }).getTime()).toBeLessThan(new Date(target).getTime());
    expect(calculatePresetReminder('2099-05-31T10:00:00+08:00', { months: 3 }).getMonth()).toBe(1);
  });

  it('saves multiple advances for a concrete edition and event', () => {
    const plans = saveReminderPlans({ editionId: 'edition-1', competitionName:'全国大学生数学建模竞赛', eventType: 'registration_end', eventLabel: '报名截止', targetAt: '2099-08-20T10:00:00+08:00', presets: ['1d', '7d'] });
    expect(plans).toHaveLength(2);
    expect(getReminderRecords().every(item => item.editionId === 'edition-1' && item.eventType === 'registration_end')).toBe(true);
    expect(plans[0].taskName).toBe('全国大学生数学建模竞赛·报名截止提醒');
  });

  it('keeps the dynamic task name within the template field limit', () => {
    const taskName = buildReminderTaskName('一个名称非常非常长的全国大学生创新创业竞赛', '报名开始');
    expect(Array.from(taskName).length).toBeLessThanOrEqual(20);
    expect(taskName.endsWith('·报名开始提醒')).toBe(true);
  });

  it('uses one one-time subscription authorization for one reminder plan', () => {
    const plans = saveReminderPlans({ editionId:'edition-1', competitionName:'测试竞赛', eventType:'registration_end', eventLabel:'报名截止', targetAt:'2099-08-20T10:00:00+08:00', presets:['1d','7d'] });
    applyReminderAuthorization(plans,'accepted','template-id');
    const accepted = getReminderRecords().filter(item=>item.authorizationStatus==='accepted');
    expect(accepted).toHaveLength(1);
    expect(accepted[0].subscriptionTemplateId).toBe('template-id');
  });

  it('rejects a custom reminder that is not before the target', () => {
    expect(() => saveReminderPlans({ editionId: 'edition-1', competitionName:'测试竞赛', eventType: 'registration_start', eventLabel: '报名开始', targetAt: '2099-08-20T10:00:00+08:00', presets: [], customAt: '2099-08-21T10:00:00+08:00' })).toThrow('必须早于目标事件');
  });
});
