import { getCompetition } from '../../services/repository';
import { isFavorite as checkFavorite, toggleFavorite } from '../../services/favorites';
import { getRemindersForEdition, removeRemindersForEdition, saveReminderPlansWithAuthorization } from '../../services/reminders';

function localDateParts(value: Date) {
  const pad = (part: number) => String(part).padStart(2, '0');
  return { date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`, time: `${pad(value.getHours())}:${pad(value.getMinutes())}` };
}

Page({
  data: {
    item: null as any, isFavorite: false, reminderCount: 0, loading: true, error: '',
    recommendationExpanded: false, rulesExpanded: false, officialInfoExpanded: false,
    reminderPanelVisible: false, reminderEventType: 'registration_end',
    reminderEvents: [] as any[],
    customDate: '', customTime: '09:00', customMinDate: '', savingReminder: false,
  },
  onLoad(options: Record<string, string>) {
    if (!options.id) { this.setData({ loading: false, error: '缺少赛事标识' }); return; }
    this.load(options.id, options.reminder === '1' ? options.eventType : '');
  },
  onShow() {
    const id = this.data.item?.id;
    if (id) this.setData({ isFavorite: checkFavorite(id), reminderCount: getRemindersForEdition(id).length });
  },
  toggleRules() { this.setData({ rulesExpanded: !this.data.rulesExpanded }); },
  toggleOfficialInfo() { this.setData({ officialInfoExpanded: !this.data.officialInfoExpanded }); },
  toggleRecommendation() { this.setData({ recommendationExpanded: !this.data.recommendationExpanded }); },
  async load(id: string, openEventType = '') {
    try {
      const ready = getApp<any>().globalData.userDataReady;
      if (ready) await ready.catch(() => undefined);
      const item = await getCompetition(id);
      this.setData({ item, isFavorite: checkFavorite(id), reminderCount: getRemindersForEdition(id).length, loading: false }, () => {
        // 从助手的铃铛、我的提醒的“编辑”进来：等页面进入动画和首次渲染完成再打开面板。
        // 缓存命中时这里几乎立刻执行，真机上会赶在页面还没稳定时打开，面板显示不出来。
        if (openEventType) setTimeout(() => this.openReminderPanel(openEventType), 350);
      });
    } catch (error) { this.setData({ loading: false, error: error instanceof Error ? error.message : '加载失败' }); }
  },
  copyRegistrationUrl() {
    const item = this.data.item;
    if (!item?.registrationUrlUsable) { wx.showToast({ title: '官方报名链接待更新', icon: 'none' }); return; }
    wx.setClipboardData({ data: item.registrationUrl, success: () => wx.showModal({ title: '链接已复制', content: '链接已复制，请在浏览器中打开并核对主办单位。', showCancel: false }) });
  },
  async favorite() {
    const id = this.data.item?.id;
    if (!id) return;
    try {
      if (!await getApp<any>().requestWechatLogin()) return;
    } catch (_error) { return; }
    if (this.data.isFavorite) {
      const reminders = getRemindersForEdition(id);
      if (reminders.length) {
        wx.showModal({ title: '取消收藏', content: `这场赛事还有 ${reminders.length} 项提醒。是否同时删除提醒？`, confirmText: '同时删除', cancelText: '保留提醒', confirmColor: '#c24141', success: (result: any) => {
          toggleFavorite(id);
          if (result.confirm) removeRemindersForEdition(id);
          this.setData({ isFavorite: false, reminderCount: getRemindersForEdition(id).length });
          wx.showToast({ title: result.confirm ? '收藏和提醒已删除' : '已取消收藏', icon: 'none' });
        } });
        return;
      }
    }
    const favorited = toggleFavorite(id);
    this.setData({ isFavorite: favorited });
    wx.showToast({ title: favorited ? '已收藏' : '已取消收藏', icon: favorited ? 'success' : 'none' });
  },
  async openReminderPanel(preferredEventType = '') {
    const item = this.data.item;
    if (!item) return;
    try {
      if (!await getApp<any>().requestWechatLogin()) return;
    } catch (_error) { return; }
    const now = Date.now();
    const reminderEvents = [
      { value: 'registration_start', label: '报名开始', targetAt: item.registrationStart || '', targetText: item.registrationStartDate || '待公布', available: Boolean(item.registrationStart && new Date(item.registrationStart).getTime() > now) },
      { value: 'registration_end', label: '报名截止', targetAt: item.registrationEnd || '', targetText: item.registrationEndDate || '待公布', available: Boolean(item.registrationEnd && new Date(item.registrationEnd).getTime() > now) },
    ];
    const preferred = reminderEvents.find(event => event.value === preferredEventType && event.available);
    const selected = preferred || reminderEvents.find(event => event.value === this.data.reminderEventType && event.available) || reminderEvents.find(event => event.available) || reminderEvents[1];
    this.setData({ reminderPanelVisible: true, reminderEvents, reminderEventType: selected.value, customMinDate: localDateParts(new Date()).date }, () => this.refreshReminderOptions());
  },
  closeReminderPanel() { this.setData({ reminderPanelVisible: false }); },
  blockPanelTap() {},
  selectReminderEvent(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value || '');
    const selected = this.data.reminderEvents.find((item: any) => item.value === value);
    if (!selected?.available) { wx.showToast({ title: selected?.targetAt ? '该时间已经过去' : '该时间尚未公布', icon: 'none' }); return; }
    this.setData({ reminderEventType: value }, () => this.refreshReminderOptions());
  },
  refreshReminderOptions() {
    const event = this.data.reminderEvents.find((item: any) => item.value === this.data.reminderEventType);
    const existing = getRemindersForEdition(this.data.item.id).filter(item => item.eventType === this.data.reminderEventType);
    const now = Date.now();
    const target = new Date(event?.targetAt || '').getTime();
    const defaultAt = Number.isFinite(target) && target > now
      ? Math.min(now + 86400000, now + (target - now) / 2) : now + 3600000;
    const parts = localDateParts(new Date(existing[0]?.remindAt || defaultAt));
    this.setData({ customDate: parts.date, customTime: parts.time });
  },
  onCustomDateChange(event: WechatMiniprogram.PickerChange) { this.setData({ customDate: String(event.detail.value) }); },
  onCustomTimeChange(event: WechatMiniprogram.PickerChange) { this.setData({ customTime: String(event.detail.value) }); },
  async saveReminder() {
    if (this.data.savingReminder) return;
    const event = this.data.reminderEvents.find((item: any) => item.value === this.data.reminderEventType);
    if (!event?.available) { wx.showToast({ title: '请选择有有效时间的提醒事件', icon: 'none' }); return; }
    try {
      const input = {
        editionId: this.data.item.id, competitionName:this.data.item.name, eventType: event.value, eventLabel: event.label, targetAt: event.targetAt,
        presets: [],
        customAt: new Date(`${this.data.customDate}T${this.data.customTime}:00`).toISOString(),
      };
      this.setData({ savingReminder: true });
      const templateId = getApp<any>().globalData.reminderTemplateId || '';
      const result = await saveReminderPlansWithAuthorization(input, templateId);
      if (result.status !== 'accepted') {
        wx.showToast({ title: result.status === 'unavailable' ? '微信通知不可用，提醒未保存' : '未授权微信通知，提醒未保存', icon: 'none' });
        return;
      }
      this.setData({ reminderPanelVisible: false, reminderCount: getRemindersForEdition(this.data.item.id).length });
      wx.showToast({ title: '提醒已保存', icon: 'success' });
    } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '提醒保存失败', icon: 'none' }); }
    finally { this.setData({ savingReminder: false }); }
  },
  feedback() {
    const item = this.data.item;
    if (!item?.id) return;
    wx.navigateTo({ url: `/pages/feedback/feedback?id=${encodeURIComponent(item.id)}&name=${encodeURIComponent(item.name || item.editionName || '赛事')}` });
  },
});
