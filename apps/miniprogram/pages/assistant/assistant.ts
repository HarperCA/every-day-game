// 赛事助手（体验版）：对话页。界面原型 https://claude.ai/artifact/RwDk3J2GF2AVaiVKs4LxKj（“可点原型”和“全部界面状态”）。
// 只给测试成员用；正式提交审核的版本里没有这一页。
import { askAssistant, assistantErrorText, botMessage, filtersForIndexPage, MAX_QUESTION_CHARS, nextMessageId, QUICK_QUESTIONS, welcomeText, withReminderState } from '../../services/assistant';
import { getRemindersForEdition, removeRemindersForEdition } from '../../services/reminders';

Page({
  data: {
    messages: [] as any[],
    quickQuestions: QUICK_QUESTIONS,
    input: '',
    sending: false,
    scrollInto: '',
    sessionId: '',
  },
  onLoad() {
    this.setData({ messages: [{ id: nextMessageId(), role: 'bot', text: welcomeText(), aiGenerated: false }] });
  },
  onShow() {
    const version = ((this as any).reminderViewVersion || 0) + 1;
    (this as any).reminderViewVersion = version;
    this.refreshReminderState();
    // 本机缓存可能早于云端提醒同步完成；同步后再刷新一次，避免铃铛显示旧状态。
    const ready = getApp<any>().globalData.userDataReady;
    if (ready) ready.then(() => {
      if ((this as any).reminderViewVersion === version) this.refreshReminderState();
    }).catch(() => undefined);
  },
  onHide() { (this as any).reminderViewVersion = ((this as any).reminderViewVersion || 0) + 1; },
  onUnload() { (this as any).reminderViewVersion = ((this as any).reminderViewVersion || 0) + 1; },
  refreshReminderState() {
    const messages = this.data.messages.map((message: any) => (message.cards?.length ? { ...message, cards: withReminderState(message.cards) } : message));
    this.setData({ messages });
  },
  onInput(event: WechatMiniprogram.Input) { this.setData({ input: event.detail.value }); },
  onSubmit() { return this.send(this.data.input); },
  onQuickQuestion(event: WechatMiniprogram.TouchEvent) { return this.send(String(event.currentTarget.dataset.text || '')); },
  onOption(event: WechatMiniprogram.TouchEvent) {
    const { messageId, text } = event.currentTarget.dataset as { messageId: string; text: string };
    if (this.data.sending) return;
    const messages = this.data.messages.map((message: any) => (message.id === messageId ? { ...message, optionsUsed: true } : message));
    this.setData({ messages }, () => this.send(String(text || '')));
  },
  onRetry(event: WechatMiniprogram.TouchEvent) { return this.send(String(event.currentTarget.dataset.text || '')); },
  openDetail(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${encodeURIComponent(String(event.currentTarget.dataset.id || ''))}` });
  },
  // 与主线详情页一致：已有提醒直接取消，没有提醒才打开主线设置面板。
  async openReminder(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '').trim();
    if (!id || (this as any).reminderActionPending) return;
    (this as any).reminderActionPending = true;
    try {
      const app = getApp<any>();
      if (!await app.requestWechatLogin()) return;
      const ready = app.globalData.userDataReady;
      if (ready) await ready.catch(() => undefined);
      // 以主线提醒服务里的实际记录判断，不信任回答生成时的卡片快照。
      if (getRemindersForEdition(id).length) {
        removeRemindersForEdition(id);
        this.refreshReminderState();
        wx.showToast({ title: '已取消提醒', icon: 'none' });
      } else {
        wx.navigateTo({ url: `/pages/detail/detail?id=${encodeURIComponent(id)}&reminder=1&eventType=registration_end` });
      }
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '提醒操作失败，请稍后重试', icon: 'none' });
    } finally {
      (this as any).reminderActionPending = false;
    }
  },
  // “去找比赛页看全部”：找比赛页是底部标签页，跳转不能带参数，条件放在 globalData 里由它 onShow 取走
  openIndexWithFilters(event: WechatMiniprogram.TouchEvent) {
    const message = this.data.messages.find((item: any) => item.id === event.currentTarget.dataset.messageId);
    getApp<any>().globalData.assistantFilters = filtersForIndexPage(message?.filters || null);
    wx.switchTab({ url: '/pages/index/index' });
  },
  async send(raw: string) {
    const text = String(raw || '').trim();
    if (!text || this.data.sending) return;
    if (Array.from(text).length > MAX_QUESTION_CHARS) { wx.showToast({ title: `问题不能超过${MAX_QUESTION_CHARS}字`, icon: 'none' }); return; }
    let loggedIn = false;
    try { loggedIn = await getApp<any>().requestWechatLogin(); } catch (_error) { loggedIn = false; }
    if (!loggedIn) return;
    const userMessage = { id: nextMessageId(), role: 'user', text };
    this.setData({ messages: [...this.data.messages, userMessage], input: '', sending: true, scrollInto: 'typing' });
    try {
      const answer = await askAssistant(text, this.data.sessionId);
      const reply = botMessage(answer);
      this.setData({ messages: [...this.data.messages, reply], sessionId: answer.sessionId || this.data.sessionId, sending: false, scrollInto: reply.id });
    } catch (error) {
      // 原话放回输入框，点“重新发送”即可，不弹错误码
      const failed = { id: nextMessageId(), role: 'bot', text: assistantErrorText(error), error: true, retryText: text };
      this.setData({ messages: [...this.data.messages, failed], input: text, sending: false, scrollInto: failed.id });
    }
  },
});
