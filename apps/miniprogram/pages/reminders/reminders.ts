import { getCurrentUserId } from '../../services/cloudSession';
import { getCompetition } from '../../services/repository';
import { getReminderRecords, removeReminder, requestReminderAuthorization, syncReminderTarget, applyReminderAuthorization } from '../../services/reminders';

function displayDateTime(value: string) {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

Page({
  data: { items: [] as any[], loading: true, loginRequired: false, error: '' },
  onShow() { this.load(); },
  onUnload() { (this as any).loadRequestId = ((this as any).loadRequestId || 0) + 1; },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    const requestId = ((this as any).loadRequestId || 0) + 1;
    (this as any).loadRequestId = requestId;
    const startingOwner = getCurrentUserId();
    if ((this as any).listOwner !== startingOwner) {
      (this as any).listOwner = startingOwner;
      this.setData({ items: [] });
    }
    this.setData({ loading: true, loginRequired: false, error: '' });
    try {
      const app = getApp<any>();
      const ready = app.globalData.userDataReady;
      if (ready) await ready.catch(() => undefined);
      if (app.globalData.loginState !== 'success') {
        this.setData({ items: [], loading: false, loginRequired: true });
        return;
      }
      const owner = getCurrentUserId();
      const records = getReminderRecords();
      const results = await Promise.all(records.map(async record => {
        try {
          const competition = await getCompetition(record.editionId);
          if (getCurrentUserId() !== owner || (this as any).loadRequestId !== requestId) return null;
          const currentTarget = record.eventType === 'registration_start' ? competition.registrationStart : competition.registrationEnd;
          let synced = record;
          const scheduleCancelled = competition.scheduleChangeStatus === 'cancelled';
          if (record.deliveryStatus === 'pending' && (scheduleCancelled || (currentTarget && currentTarget !== record.targetAt))) {
            const changeStatus = scheduleCancelled ? 'cancelled' : competition.scheduleChangeStatus === 'postponed' ? 'postponed' : 'time_updated';
            synced = syncReminderTarget(record, currentTarget || record.targetAt, changeStatus);
          }
          const authorizationLabel = synced.authorizationStatus === 'accepted' ? '微信通知已授权' : synced.authorizationStatus === 'rejected' ? '微信通知未授权' : synced.authorizationStatus === 'unavailable' ? '当前仅站内提醒' : '待请求微信授权';
          const changeLabel = synced.scheduleChangeStatus === 'cancelled' ? '赛事已取消' : synced.scheduleChangeStatus === 'postponed' ? '赛事已延期' : synced.scheduleChangeStatus === 'time_updated' ? '时间已更新' : '';
          return {
            ...synced, competitionName: competition.name, editionName: competition.editionName,
            targetAtDisplay: displayDateTime(synced.targetAt), remindAtDisplay: displayDateTime(synced.remindAt),
            authorizationLabel, changeLabel, isExpired: synced.deliveryStatus === 'expired', isManualRequired:synced.deliveryStatus === 'manual_required',
          };
        } catch (_error) {
          return {
            ...record,
            competitionName: record.competitionName || '赛事暂不可读取或已下架',
            targetAtDisplay: displayDateTime(record.targetAt),
            remindAtDisplay: displayDateTime(record.remindAt),
            unavailable: true,
          };
        }
      }));
      if (getCurrentUserId() !== owner || (this as any).loadRequestId !== requestId) return;
      const items = results.filter(Boolean).sort((a: any, b: any) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime());
      this.setData({ items, loading: false });
    } catch (error) { if ((this as any).loadRequestId !== requestId) return; this.setData({ loading: false, error: error instanceof Error ? error.message : '提醒加载失败' }); }
  },
  retry() { this.load(); },
  async requestWechatLogin() {
    try {
      if (await getApp<any>().requestWechatLogin()) this.load();
    } catch (_error) { /* 登录状态由 App 维护 */ }
  },
  openDetail(event: WechatMiniprogram.TouchEvent) { if (event.currentTarget.dataset.unavailable) return; wx.navigateTo({ url: `/pages/detail/detail?id=${event.currentTarget.dataset.editionId}` }); },
  editReminder(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${event.currentTarget.dataset.editionId}&reminder=1&eventType=${event.currentTarget.dataset.eventType}` });
  },
  deleteReminder(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '');
    wx.showModal({ title: '删除提醒', content: '确定删除这条提醒计划吗？', confirmColor: '#c24141', success: (result: any) => { if (!result.confirm) return; removeReminder(id); this.load(); wx.showToast({ title: '已删除', icon: 'success' }); } });
  },
  async authorize(event: WechatMiniprogram.TouchEvent) {
    try {
    const id = String(event.currentTarget.dataset.id || '');
    const templateId = getApp<any>().globalData.reminderTemplateId || '';
    const owner = getCurrentUserId();
    const plans = getReminderRecords().filter(item => item.id === id);
    const status = await requestReminderAuthorization(templateId);
    if (getCurrentUserId() !== owner) throw new Error('账号已变更，请重新操作');
    applyReminderAuthorization(plans, status, templateId);
    this.load();
    wx.showToast({ title: status === 'accepted' ? '授权成功' : status === 'unavailable' ? '订阅模板尚未配置' : '暂未授权', icon: status === 'accepted' ? 'success' : 'none' });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '微信授权请求失败', icon:'none' });
    }
  },
  goFindCompetition() { wx.switchTab({ url: '/pages/index/index' }); },
});
