import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../apps/miniprogram/services/cloudSession', () => ({
  callUserData: vi.fn(),
  isCloudSessionReady: () => true,
  getCurrentUserId: () => 'test-user',
}));
import { applyReminderAuthorization, buildReminderTaskName, calculatePresetReminder, getReminderRecords, saveReminderPlans, saveReminderPlansWithAuthorization } from '../apps/miniprogram/services/reminders';
import { callUserData } from '../apps/miniprogram/services/cloudSession';

const storage = new Map<string, unknown>();

beforeEach(() => {
  storage.clear();
  vi.mocked(callUserData).mockClear();
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

  it('asks for notification permission before saving and saves only when accepted', async () => {
    const requestSubscribeMessage = vi.fn(({ success }) => {
      expect(getReminderRecords()).toHaveLength(0);
      success({ 'template-id': 'accept' });
    });
    (globalThis as any).wx.requestSubscribeMessage = requestSubscribeMessage;
    const result = await saveReminderPlansWithAuthorization({ editionId:'edition-1', competitionName:'测试竞赛', eventType:'registration_end', eventLabel:'报名截止', targetAt:'2099-08-20T10:00:00+08:00', presets:['1d'] }, 'template-id');
    expect(requestSubscribeMessage).toHaveBeenCalledOnce();
    expect(result.status).toBe('accepted');
    expect(getReminderRecords()).toHaveLength(1);
    expect(getReminderRecords()[0].authorizationStatus).toBe('accepted');
    await vi.waitFor(() => expect(vi.mocked(callUserData).mock.calls.some(([action, payload]: any) => action === 'replaceReminderEvent' && payload.records.every((record: any) => record.authorizationStatus === 'accepted' && record.subscriptionTemplateId === 'template-id'))).toBe(true));
    expect(vi.mocked(callUserData).mock.calls.some(([action]) => action === 'upsertReminders')).toBe(false);
  });

  it('does not create extra unauthorized plans from one subscription', async () => {
    const request = vi.fn();
    (globalThis as any).wx.requestSubscribeMessage = request;
    await expect(saveReminderPlansWithAuthorization({ editionId:'edition-1', competitionName:'测试竞赛', eventType:'registration_end', eventLabel:'报名截止', targetAt:'2099-08-20T10:00:00+08:00', presets:['1d','7d'] }, 'template-id')).rejects.toThrow('一个提醒时间');
    expect(request).not.toHaveBeenCalled();
    expect(getReminderRecords()).toHaveLength(0);
  });

  it('distinguishes a missing template from a user refusal without saving', async () => {
    (globalThis as any).wx.requestSubscribeMessage = ({ fail }: any) => fail({errCode:20001,errMsg:'No template data return'});
    await expect(saveReminderPlansWithAuthorization({editionId:'edition-1',competitionName:'测试竞赛',eventType:'registration_end',eventLabel:'报名截止',targetAt:'2099-08-20T10:00:00+08:00',presets:[],customAt:'2099-08-19T10:00:00+08:00'},'template-id')).rejects.toThrow('模板不存在');
    expect(getReminderRecords()).toHaveLength(0);
  });

  it('does not save when notification permission is denied or unavailable', async () => {
    const input = { editionId:'edition-1', competitionName:'测试竞赛', eventType:'registration_end' as const, eventLabel:'报名截止', targetAt:'2099-08-20T10:00:00+08:00', presets:['1d'] };
    (globalThis as any).wx.requestSubscribeMessage = ({ success }: any) => success({ 'template-id': 'reject' });
    expect((await saveReminderPlansWithAuthorization(input, 'template-id')).status).toBe('rejected');
    expect(getReminderRecords()).toHaveLength(0);
    expect((await saveReminderPlansWithAuthorization(input, '')).status).toBe('unavailable');
    expect(getReminderRecords()).toHaveLength(0);
  });

  // 微信要求订阅授权必须在用户点按的同一时刻发出，中间不能先等别的：调用后不等待就应该已经发出申请
  it('asks for notification permission in the same tick as the save tap', () => {
    const request = vi.fn();
    (globalThis as any).wx.requestSubscribeMessage = request;
    void saveReminderPlansWithAuthorization({ editionId:'edition-1', competitionName:'测试竞赛', eventType:'registration_end', eventLabel:'报名截止', targetAt:'2099-08-20T10:00:00+08:00', presets:['1d'] }, 'template-id');
    expect(request).toHaveBeenCalledOnce();
  });
});
