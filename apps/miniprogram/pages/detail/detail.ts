import { getCompetition } from '../../services/repository';
import { isFavorite as checkFavorite, toggleFavorite } from '../../services/favorites';
import { getRemindersForEdition, removeRemindersForEdition, saveReminderPlansWithAuthorization } from '../../services/reminders';
import { findMyTeamForCompetition } from '../../services/teams';

function localDateParts(value: Date) {
  const pad = (part: number) => String(part).padStart(2, '0');
  return { date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`, time: `${pad(value.getHours())}:${pad(value.getMinutes())}` };
}

Page({
  data: {
    item: null as any, isFavorite: false, reminderCount: 0, loading: true, error: '', myTeamId: '',
    recommendationExpanded: false, rulesExpanded: false, officialInfoExpanded: false,
    reminderPanelVisible: false, reminderEventType: 'registration_end',
    reminderEvents: [] as any[],
    customDate: '', customTime: '09:00', customMinDate: '', customMaxDate: '', customMinTime: '00:00', customMaxTime: '23:59', savingReminder: false,
  },
  onLoad(options: Record<string, string>) {
    if (!options.id) { this.setData({ loading: false, error: '缺少赛事标识' }); return; }
    this.load(options.id, options.reminder === '1' ? options.eventType : '');
  },
  onShow() {
    const id = this.data.item?.id;
    if (id) this.setData({ isFavorite: checkFavorite(id), reminderCount: getRemindersForEdition(id).length });
    if (id) this.refreshTeamEntry();
  },
  // 这场比赛我有没有队伍：从北京读（2026-11-12），读不到当没有
  async refreshTeamEntry() {
    const id = this.data.item?.id || '';
    const team = await findMyTeamForCompetition(id).catch(() => null);
    if (id === (this.data.item?.id || '')) this.setData({ myTeamId: team?.id || '' });
  },
  // 组队入口：这场比赛已有队伍就进队伍页，没有就发起
  openTeamEntry() {
    const { item, myTeamId } = this.data;
    if (!item?.id) return;
    // 刚从这支队伍的页面过来就直接返回，来回点不会把页面越叠越深
    const pages = getCurrentPages();
    const previous = pages[pages.length - 2];
    if (myTeamId && previous?.route === 'pages/team-detail/team-detail' && previous.data?.id === myTeamId) { wx.navigateBack(); return; }
    wx.navigateTo({ url: myTeamId
      ? `/pages/team-detail/team-detail?id=${encodeURIComponent(myTeamId)}`
      : `/pages/team-create/team-create?id=${encodeURIComponent(item.id)}&name=${encodeURIComponent(item.name || '')}` });
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
        // 从“我的提醒”的“编辑”进来：等页面进入动画和首次渲染完成再打开面板。
        // 缓存命中时这里几乎立刻执行，真机上会赶在页面还没稳定时打开，面板显示不出来。
        if (openEventType) setTimeout(() => this.openReminderPanel(openEventType), 350);
      });
      this.refreshTeamEntry();
    } catch (error) { this.setData({ loading: false, error: error instanceof Error ? error.message : '加载失败' }); }
  },
  copyRegistrationUrl() {
    const item = this.data.item;
    if (!item?.registrationUrlUsable) { wx.showToast({ title: '官方报名链接待更新', icon: 'none' }); return; }
    // 有些报名链接是平台首页（如慕测平台），打开后还要按步骤找报名入口：把库里的报名方式一起写在提示里（2026-10-18，用户定）
    const method = item.fieldText?.registrationMethod;
    const content = method && method !== '信息不足'
      ? `请在浏览器中打开并核对主办单位。\n报名方式：${method}`
      : '链接已复制，请在浏览器中打开并核对主办单位。';
    wx.setClipboardData({ data: item.registrationUrl, success: () => wx.showModal({ title: '链接已复制', content, showCancel: false }) });
  },
  // 高校转发的转发页链接：小程序不能直接打开外部网页，和“复制官方报名链接”一样复制到剪贴板（2026-11-12）
  copySourceUrl() {
    const url = this.data.item?.infoSourceUrl;
    if (!url) return;
    wx.setClipboardData({ data: url, success: () => wx.showModal({ title: '链接已复制', content: '这是高校转发的通知，请在浏览器中打开查看。报名时间和要求以官方通知为准。', showCancel: false }) });
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
  // 底部铃铛（2026-10-18，用户定）：已有提醒时点一下直接取消这场比赛的全部提醒；没有提醒时打开设置面板
  async toggleReminder() {
    const id = this.data.item?.id;
    if (!id) return;
    if (!this.data.reminderCount) { this.openReminderPanel(); return; }
    try {
      if (!await getApp<any>().requestWechatLogin()) return;
    } catch (_error) { return; }
    removeRemindersForEdition(id);
    this.setData({ reminderCount: getRemindersForEdition(id).length });
    wx.showToast({ title: '已取消提醒', icon: 'none' });
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
    this.applyCustomBounds(parts.date, parts.time);
  },
  // 自定义提醒时间的可选范围（2026-10-17，用户定）：
  // 日期在“今天”到“截止日”之间；选今天时，时间从现在往后；选截止日当天时，时间到截止时刻之前。
  // 选出范围的日期或时间会被挪回范围内。保存时 validateReminderPlans 仍会再检查一次。
  applyCustomBounds(date: string, time: string) {
    const event = this.data.reminderEvents.find((item: any) => item.value === this.data.reminderEventType);
    const earliest = localDateParts(new Date(Date.now() + 60000));
    const target = new Date(event?.targetAt || '').getTime();
    const latest = Number.isFinite(target) ? localDateParts(new Date(target - 60000)) : null;
    const minDate = earliest.date;
    const maxDate = latest && latest.date >= minDate ? latest.date : '';
    let pickedDate = date < minDate ? minDate : date;
    if (maxDate && pickedDate > maxDate) pickedDate = maxDate;
    const minTime = pickedDate === minDate ? earliest.time : '00:00';
    const maxTime = maxDate && pickedDate === maxDate ? latest!.time : '23:59';
    let pickedTime = time < minTime ? minTime : time;
    if (pickedTime > maxTime) pickedTime = maxTime;
    this.setData({ customDate: pickedDate, customTime: pickedTime, customMinDate: minDate, customMaxDate: maxDate, customMinTime: minTime, customMaxTime: maxTime });
  },
  onCustomDateChange(event: WechatMiniprogram.PickerChange) { this.applyCustomBounds(String(event.detail.value), this.data.customTime); },
  onCustomTimeChange(event: WechatMiniprogram.PickerChange) { this.applyCustomBounds(this.data.customDate, String(event.detail.value)); },
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
  // 转发卡片：页面上的转发按钮和右上角菜单的“转发”都走这里。不传 imageUrl，封面用微信默认截图。
  onShareAppMessage() {
    const item = this.data.item;
    if (!item?.id) return { title: '竞赛雷达', path: '/pages/index/index' };
    return { title: item.name, path: `/pages/detail/detail?id=${encodeURIComponent(item.id)}` };
  },
  feedback() {
    const item = this.data.item;
    if (!item?.id) return;
    wx.navigateTo({ url: `/pages/feedback/feedback?id=${encodeURIComponent(item.id)}&name=${encodeURIComponent(item.name || item.editionName || '赛事')}` });
  },
});
