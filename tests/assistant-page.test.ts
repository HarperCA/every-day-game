import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// 赛事助手对话页（体验版）。接口、提醒、偏好都用假的，只看页面逻辑。
const callAssistant = vi.fn();
vi.mock('../apps/miniprogram/services/cloudSession', () => ({ callAssistant }));
const reminders = vi.hoisted(() => ({ records: new Map<string, any[]>(), remove: vi.fn() }));
vi.mock('../apps/miniprogram/services/reminders', () => ({
  getRemindersForEdition: (id: string) => reminders.records.get(id) || [],
  removeRemindersForEdition: reminders.remove,
}));
const preferences = { categories: [] as string[], province: '' };
vi.mock('../apps/miniprogram/services/competitionPreferences', () => ({ loadCompetitionPreferences: () => preferences }));

let definition: any;
let assistant: typeof import('../apps/miniprogram/services/assistant');
const app = { globalData: {} as Record<string, unknown>, requestWechatLogin: vi.fn() };

function makePage() {
  return { ...definition, data: structuredClone(definition.data), setData(patch: any, callback?: () => void) { Object.assign(this.data, patch); callback?.(); } };
}
const answer = (overrides: any = {}) => ({
  turnId: 'turn-1', sessionId: 'session-' + 'a'.repeat(24), status: 'answered', reply: '查到 2 场。', aiGenerated: true, options: [],
  cards: [
    { id: 'edition-a', name: '智能汽车竞赛', editionName: '', eventLevel: '国家级', registrationStatus: '报名中', registrationEnd: '2026-10-20', registrationEndNote: '', daysLeft: 5 },
    { id: 'edition-reminded', name: '计算机设计大赛', editionName: '', eventLevel: '国家级', registrationStatus: '报名中', registrationEnd: '2026-11-10', registrationEndNote: '', daysLeft: 26 },
  ],
  total: 9, filters: { professions: ['计算机与AI'], participationFormats: ['团队赛', '个人或团队均可'], registrationWithin: '1m' },
  ...overrides,
});

beforeAll(async () => {
  vi.stubGlobal('Page', (options: any) => { definition = options; });
  vi.stubGlobal('getApp', () => app);
  await import('../apps/miniprogram/pages/assistant/assistant');
  assistant = await import('../apps/miniprogram/services/assistant');
});
beforeEach(() => {
  callAssistant.mockReset();
  app.globalData = {};
  app.requestWechatLogin.mockReset().mockResolvedValue(true);
  reminders.records.clear();
  reminders.records.set('edition-reminded', [{ id: 'r1' }]);
  reminders.remove.mockReset().mockImplementation((id: string) => reminders.records.delete(id));
  preferences.categories = [];
  vi.stubGlobal('wx', { showToast: vi.fn(), navigateTo: vi.fn(), switchTab: vi.fn() });
});

describe('赛事助手对话页', () => {
  it('开场白是固定文案，带上用户选过的专业大类', () => {
    preferences.categories = ['计算机与AI'];
    const page = makePage();
    page.onLoad();
    expect(page.data.messages).toHaveLength(1);
    expect(page.data.messages[0]).toMatchObject({ role: 'bot', aiGenerated: false });
    expect(page.data.messages[0].text).toContain('计算机与AI');
  });

  it('发一句话：带上偏好调接口，显示 AI 回答和卡片，记住 sessionId', async () => {
    preferences.categories = ['计算机与AI'];
    callAssistant.mockResolvedValue(answer());
    const page = makePage();
    page.onLoad();
    page.onInput({ detail: { value: '能组队的比赛' } });
    await page.onSubmit();
    expect(callAssistant).toHaveBeenCalledWith({ message: '能组队的比赛', profileCategories: ['计算机与AI'] });
    const [, user, bot] = page.data.messages;
    expect(user).toMatchObject({ role: 'user', text: '能组队的比赛' });
    expect(bot).toMatchObject({ role: 'bot', text: '查到 2 场。', aiGenerated: true, moreText: '还有 7 场，去找比赛页看全部' });
    expect(bot.cards[0]).toMatchObject({ id: 'edition-a', deadline: '截止 10月20日', left: '还剩 5 天', soon: true, hasReminder: false });
    expect(bot.cards[1]).toMatchObject({ soon: false, hasReminder: true });
    expect(page.data.sessionId).toBe('session-' + 'a'.repeat(24));
    expect(page.data.input).toBe('');
    expect(page.data.sending).toBe(false);
  });

  it('第二句带上服务器给的 sessionId', async () => {
    callAssistant.mockResolvedValue(answer());
    const page = makePage();
    page.onLoad();
    await page.send('第一句');
    await page.send('第二句');
    expect(callAssistant.mock.calls[1][0]).toMatchObject({ message: '第二句', sessionId: 'session-' + 'a'.repeat(24) });
  });

  it('追问：显示选项，点过一次就不能再点，点的选项作为下一句发出', async () => {
    callAssistant.mockResolvedValueOnce(answer({ status: 'clarify', reply: '你是什么专业？', options: ['计算机', '机械'], cards: [], total: 0, filters: null }));
    callAssistant.mockResolvedValueOnce(answer());
    const page = makePage();
    page.onLoad();
    await page.send('推荐比赛');
    const clarify = page.data.messages[2];
    expect(clarify.options).toEqual(['计算机', '机械']);
    page.onOption({ currentTarget: { dataset: { messageId: clarify.id, text: '计算机' } } });
    await vi.waitFor(() => expect(callAssistant).toHaveBeenCalledTimes(2));
    expect(page.data.messages[2].optionsUsed).toBe(true);
    expect(callAssistant.mock.calls[1][0].message).toBe('计算机');
  });

  it('出错：显示看得懂的话，原话放回输入框，可以重新发送', async () => {
    callAssistant.mockRejectedValueOnce(new Error('assistant_ai_failed'));
    const page = makePage();
    page.onLoad();
    await page.send('找比赛');
    const failed = page.data.messages[2];
    expect(failed).toMatchObject({ role: 'bot', error: true, retryText: '找比赛', text: '助手暂时没能回答，请再发一次。' });
    expect(page.data.input).toBe('找比赛');
    callAssistant.mockResolvedValueOnce(answer());
    await page.onRetry({ currentTarget: { dataset: { text: failed.retryText } } });
    expect(callAssistant).toHaveBeenCalledTimes(2);
  });

  it('不认识的错误统一说网络不稳定，不出现错误码', () => {
    expect(assistant.assistantErrorText(new Error('internal_server_error'))).toBe('网络不太稳定，这条没有发出去。');
    expect(assistant.assistantErrorText(new Error('网络不太稳定，请稍后重试'))).toBe('网络不太稳定，请稍后重试');
  });

  it('空的、超长的、发送中的都不发', async () => {
    const page = makePage();
    page.onLoad();
    await page.send('   ');
    await page.send('字'.repeat(301));
    expect(wx.showToast).toHaveBeenCalledWith({ title: '问题不能超过300字', icon: 'none' });
    page.setData({ sending: true });
    await page.send('找比赛');
    expect(callAssistant).not.toHaveBeenCalled();
  });

  it('没登录成功就不发', async () => {
    app.requestWechatLogin.mockResolvedValue(false);
    const page = makePage();
    page.onLoad();
    await page.send('找比赛');
    expect(callAssistant).not.toHaveBeenCalled();
    expect(page.data.messages).toHaveLength(1);
  });

  it('点卡片进详情；未设置提醒时点铃铛进详情并打开报名截止提醒', async () => {
    const page = makePage();
    page.openDetail({ currentTarget: { dataset: { id: 'edition-a' } } });
    await page.openReminder({ currentTarget: { dataset: { id: 'edition-a' } } });
    expect(wx.navigateTo).toHaveBeenNthCalledWith(1, { url: '/pages/detail/detail?id=edition-a' });
    expect(wx.navigateTo).toHaveBeenNthCalledWith(2, { url: '/pages/detail/detail?id=edition-a&reminder=1&eventType=registration_end' });
  });

  it('已有提醒时直接取消，刷新所有回答中的同场铃铛；再次点击才能重新设置', async () => {
    const page = makePage();
    page.data.messages = [assistant.botMessage(answer()), assistant.botMessage(answer())];
    const event = { currentTarget: { dataset: { id: 'edition-reminded' } } };
    await page.openReminder(event);
    expect(reminders.remove).toHaveBeenCalledExactlyOnceWith('edition-reminded');
    expect(wx.navigateTo).not.toHaveBeenCalled();
    expect(page.data.messages.every((message: any) => !message.cards[1].hasReminder)).toBe(true);
    expect(wx.showToast).toHaveBeenCalledWith({ title: '已取消提醒', icon: 'none' });
    await page.openReminder(event);
    expect(reminders.remove).toHaveBeenCalledTimes(1);
    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/detail/detail?id=edition-reminded&reminder=1&eventType=registration_end' });
  });

  it('等云端同步完成再判断已有提醒，不根据旧卡片状态打开设置面板', async () => {
    let finishSync!: () => void;
    app.globalData.userDataReady = new Promise<void>(resolve => { finishSync = resolve; });
    const page = makePage();
    const task = page.openReminder({ currentTarget: { dataset: { id: 'edition-a' } } });
    await Promise.resolve();
    expect(wx.navigateTo).not.toHaveBeenCalled();
    reminders.records.set('edition-a', [{ id: 'cloud-reminder' }]);
    finishSync();
    await task;
    expect(reminders.remove).toHaveBeenCalledWith('edition-a');
    expect(wx.navigateTo).not.toHaveBeenCalled();
  });

  it('重新显示页面后，云端同步完成会刷新铃铛状态', async () => {
    let finishSync!: () => void;
    app.globalData.userDataReady = new Promise<void>(resolve => { finishSync = resolve; });
    const page = makePage();
    page.data.messages = [assistant.botMessage(answer())];
    page.onShow();
    expect(page.data.messages[0].cards[0].hasReminder).toBe(false);
    reminders.records.set('edition-a', [{ id: 'cloud-reminder' }]);
    finishSync();
    await vi.waitFor(() => expect(page.data.messages[0].cards[0].hasReminder).toBe(true));
  });

  it('页面离开后，不再由旧的云同步回调刷新页面', async () => {
    let finishSync!: () => void;
    app.globalData.userDataReady = new Promise<void>(resolve => { finishSync = resolve; });
    const page = makePage();
    page.data.messages = [assistant.botMessage(answer())];
    page.onShow();
    page.onUnload();
    reminders.records.set('edition-a', [{ id: 'cloud-reminder' }]);
    finishSync();
    await Promise.resolve();
    expect(page.data.messages[0].cards[0].hasReminder).toBe(false);
  });

  it('未登录成功不能取消或设置提醒', async () => {
    app.requestWechatLogin.mockResolvedValue(false);
    const page = makePage();
    await page.openReminder({ currentTarget: { dataset: { id: 'edition-reminded' } } });
    await page.openReminder({ currentTarget: { dataset: { id: 'edition-a' } } });
    expect(reminders.remove).not.toHaveBeenCalled();
    expect(wx.navigateTo).not.toHaveBeenCalled();
  });

  it('连续点按不会将同一次取消又变成重新设置', async () => {
    let finishLogin!: (success: boolean) => void;
    app.requestWechatLogin.mockReturnValue(new Promise<boolean>(resolve => { finishLogin = resolve; }));
    const page = makePage();
    const event = { currentTarget: { dataset: { id: 'edition-reminded' } } };
    const first = page.openReminder(event);
    const second = page.openReminder(event);
    finishLogin(true);
    await Promise.all([first, second]);
    expect(app.requestWechatLogin).toHaveBeenCalledTimes(1);
    expect(reminders.remove).toHaveBeenCalledTimes(1);
    expect(wx.navigateTo).not.toHaveBeenCalled();
  });

  it('取消失败时不假报成功，释放操作锁后允许重试', async () => {
    reminders.remove.mockImplementationOnce(() => { throw new Error('提醒删除失败'); });
    const page = makePage();
    const event = { currentTarget: { dataset: { id: 'edition-reminded' } } };
    await page.openReminder(event);
    expect(wx.showToast).toHaveBeenCalledWith({ title: '提醒删除失败', icon: 'none' });
    expect(wx.showToast).not.toHaveBeenCalledWith({ title: '已取消提醒', icon: 'none' });
    expect(wx.navigateTo).not.toHaveBeenCalled();
    await page.openReminder(event);
    expect(reminders.remove).toHaveBeenCalledTimes(2);
    expect(reminders.records.has('edition-reminded')).toBe(false);
  });

  it('“去找比赛页看全部”：把条件放进 globalData，切到找比赛页', async () => {
    callAssistant.mockResolvedValue(answer());
    const page = makePage();
    page.onLoad();
    await page.send('能组队的比赛');
    page.openIndexWithFilters({ currentTarget: { dataset: { messageId: page.data.messages[2].id } } });
    expect(app.globalData.assistantFilters).toEqual({
      keyword: '', competitionCategories: ['计算机与AI'], eventLevel: '', registrationStatus: '',
      participationFormat: '', registrationWithin: '1m', region: '', feeType: '', sortBy: '',
    });
    expect(wx.switchTab).toHaveBeenCalledWith({ url: '/pages/index/index' });
  });
});

describe('赛事助手：卡片显示', () => {
  it('截止、今天截止、已截止、没有日期', () => {
    const base = { id: 'a', name: 'a', editionName: '', eventLevel: '', registrationEndNote: '' };
    expect(assistant.cardView({ ...base, registrationStatus: '报名中', registrationEnd: '2026-10-16', daysLeft: 0 })).toMatchObject({ deadline: '截止 10月16日', left: '今天截止', soon: true });
    expect(assistant.cardView({ ...base, registrationStatus: '已截止', registrationEnd: '2026-10-01', daysLeft: 0 })).toMatchObject({ left: '已截止', soon: false });
    expect(assistant.cardView({ ...base, registrationStatus: '时间待公布', registrationEnd: null, daysLeft: null })).toMatchObject({ deadline: '时间待公布', left: '', soon: false });
    expect(assistant.cardView({ ...base, registrationStatus: '报名中', registrationEnd: null, registrationEndNote: '以学校通知为准', daysLeft: null })).toMatchObject({ deadline: '以学校通知为准' });
  });

  it('参赛形式只选了一个时才带到找比赛页', () => {
    expect(assistant.filtersForIndexPage({ participationFormats: ['团队赛'] }).participationFormat).toBe('团队赛');
    expect(assistant.filtersForIndexPage({ participationFormats: ['团队赛', '个人或团队均可'] }).participationFormat).toBe('');
    expect(assistant.filtersForIndexPage(null).competitionCategories).toEqual([]);
    // 找比赛页没有按截止日排序：deadline 不带过去，time 带过去
    expect(assistant.filtersForIndexPage({ sortBy:'deadline' }).sortBy).toBe('');
    expect(assistant.filtersForIndexPage({ sortBy:'time' }).sortBy).toBe('time');
  });
});
