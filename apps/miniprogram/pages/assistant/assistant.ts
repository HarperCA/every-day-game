// 赛事助手（体验版）：对话页。界面原型 https://claude.ai/artifact/RwDk3J2GF2AVaiVKs4LxKj（“可点原型”和“全部界面状态”）。
// 只给测试成员用；正式提交审核的版本里没有这一页。
import { askAssistant, assistantErrorText, botMessage, filtersForIndexPage, MAX_QUESTION_CHARS, nextMessageId, QUICK_QUESTIONS, welcomeText, withReminderState } from '../../services/assistant';

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
    // 从详情页设完提醒回来：刷新铃铛状态
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
  // 铃铛：进详情页并直接打开提醒面板，用现有的提醒功能（详情页 onLoad 的 reminder=1）
  openReminder(event: WechatMiniprogram.TouchEvent) {
    const id = encodeURIComponent(String(event.currentTarget.dataset.id || ''));
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}&reminder=1&eventType=registration_end` });
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
