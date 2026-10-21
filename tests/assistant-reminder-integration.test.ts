import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// 页面跨入口集成测试：使用主线真实提醒服务，只替换微信和云请求边界。
const cloud = vi.hoisted(() => ({ callUserData: vi.fn(), callAssistant: vi.fn() }));
vi.mock('../apps/miniprogram/services/cloudSession', () => ({
  callUserData: cloud.callUserData,
  callAssistant: cloud.callAssistant,
  getCurrentUserId: () => 'wechat-test',
  isCloudSessionReady: () => true,
}));
vi.mock('../apps/miniprogram/services/repository', () => ({ getCompetition: vi.fn() }));
vi.mock('../apps/miniprogram/services/favorites', () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }));
vi.mock('../apps/miniprogram/services/competitionPreferences', () => ({ loadCompetitionPreferences: () => ({ categories: [] }) }));

import { getRemindersForEdition } from '../apps/miniprogram/services/reminders';

let detailDefinition: any;
let assistantDefinition: any;
const storage = new Map<string, unknown>();
const app = {
  globalData: { userDataReady: Promise.resolve(), reminderTemplateId: 'template-test' },
  requestWechatLogin: async () => true,
};
const makePage = (definition: any) => ({
  ...definition, data: structuredClone(definition.data),
  setData(patch: any, callback?: () => void) { Object.assign(this.data, patch); callback?.(); },
});
function detailPage() {
  const page = makePage(detailDefinition);
  Object.assign(page.data, {
    item: { id: 'edition-shared', name: '测试赛事' },
    reminderEvents: [{ value: 'registration_end', label: '报名截止', available: true, targetAt: '2099-12-31T23:59:59+08:00' }],
    customDate: '2099-12-30', customTime: '09:00',
  });
  return page;
}
function assistantPage() {
  const page = makePage(assistantDefinition);
  page.data.messages = [{ id: 'message', cards: [{ id: 'edition-shared', hasReminder: false }] }];
  return page;
}

beforeAll(async () => {
  vi.stubGlobal('getApp', () => app);
  vi.stubGlobal('Page', (definition: any) => { detailDefinition = definition; });
  await import('../apps/miniprogram/pages/detail/detail');
  vi.stubGlobal('Page', (definition: any) => { assistantDefinition = definition; });
  await import('../apps/miniprogram/pages/assistant/assistant');
});
beforeEach(() => {
  storage.clear();
  cloud.callUserData.mockReset().mockResolvedValue({ ok: true });
  vi.stubGlobal('wx', {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    showToast: vi.fn(), navigateTo: vi.fn(),
    requestSubscribeMessage: vi.fn(({ success }: any) => success({ 'template-test': 'accept' })),
  });
});

describe('助手和主线详情页共用提醒', () => {
  it('详情授权保存后助手显示已提醒；助手取消通过同一服务删除，并可再次进入主线设置', async () => {
    const detail = detailPage();
    const assistant = assistantPage();
    await detail.saveReminder();
    expect(wx.requestSubscribeMessage).toHaveBeenCalledOnce();
    expect(getRemindersForEdition('edition-shared')).toHaveLength(1);
    await vi.waitFor(() => expect(cloud.callUserData).toHaveBeenCalledWith('replaceReminderEvent', expect.any(Object)));

    assistant.onShow();
    expect(assistant.data.messages[0].cards[0].hasReminder).toBe(true);
    const event = { currentTarget: { dataset: { id: 'edition-shared' } } };
    await assistant.openReminder(event);
    expect(getRemindersForEdition('edition-shared')).toEqual([]);
    expect(assistant.data.messages[0].cards[0].hasReminder).toBe(false);
    await vi.waitFor(() => expect(cloud.callUserData).toHaveBeenCalledWith('removeRemindersForEdition', { editionId: 'edition-shared' }));
    detail.onShow();
    expect(detail.data.reminderCount).toBe(0);

    await assistant.openReminder(event);
    expect(wx.navigateTo).toHaveBeenCalledExactlyOnceWith({ url: '/pages/detail/detail?id=edition-shared&reminder=1&eventType=registration_end' });
    // 打开设置不等于保存，更不能由助手直接消耗一次订阅授权。
    expect(wx.requestSubscribeMessage).toHaveBeenCalledOnce();
  });

  it('助手入口进入主线设置后，拒绝微信授权不保存提醒，也不点亮铃铛', async () => {
    (wx.requestSubscribeMessage as any).mockImplementation(({ success }: any) => success({ 'template-test': 'reject' }));
    const assistant = assistantPage();
    await assistant.openReminder({ currentTarget: { dataset: { id: 'edition-shared' } } });
    await detailPage().saveReminder();
    assistant.onShow();
    expect(getRemindersForEdition('edition-shared')).toEqual([]);
    expect(assistant.data.messages[0].cards[0].hasReminder).toBe(false);
    expect(cloud.callUserData).not.toHaveBeenCalled();
  });
});
