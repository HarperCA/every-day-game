import { getCurrentUserId } from '../../services/cloudSession';
import { getCompetition } from '../../services/repository';
import { getFavoriteRecords, removeFavorite } from '../../services/favorites';
import { getRemindersForEdition, removeRemindersForEdition } from '../../services/reminders';
import { withCard } from '../../services/cardCover';

Page({
  data: {
    items: [] as any[],
    loading: true,
    loginRequired: false,
    error: '',
    emptyHelp: false,
  },

  onShow() {
    this.load();
  },

  onUnload() { (this as any).loadRequestId = ((this as any).loadRequestId || 0) + 1; },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

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
      const records = getFavoriteRecords();
      const results = await Promise.all(records.map(async (record) => {
        try {
          const item = await getCompetition(record.editionId);
          return withCard({
            ...item,
            isFavorite: true,
            favoriteAt: record.createdAt.substring(0, 10),
            isEnded: item.dataStatus === 'archived' || item.registrationStatus === '已截止',
          });
        } catch (_error) {
          return withCard({
            id: record.editionId,
            name: '赛事暂不可读取或已下架',
            isFavorite: true,
            favoriteAt: record.createdAt.substring(0, 10),
            unavailable: true,
          });
        }
      }));
      if ((this as any).loadRequestId !== requestId || getCurrentUserId() !== owner) return;
      this.setData({ items: results, loading: false });
    } catch (error) {
      if ((this as any).loadRequestId !== requestId) return;
      this.setData({
        loading: false,
        error: error instanceof Error ? error.message : '收藏加载失败',
      });
    }
  },

  retry() {
    this.load();
  },

  async requestWechatLogin() {
    try {
      if (await getApp<any>().requestWechatLogin()) this.load();
    } catch (_error) { /* 登录状态由 App 维护 */ }
  },

  openDetail(event: any) {
    if (event.currentTarget.dataset.unavailable) return;
    wx.navigateTo({ url: `/pages/detail/detail?id=${event.currentTarget.dataset.id}` });
  },

  cancelFavorite(event: any) {
    const owner = getCurrentUserId();
    const id = event.currentTarget.dataset.id;
    const reminders = getRemindersForEdition(id);
    if (reminders.length) {
      wx.showModal({
        title: '取消收藏',
        content: `这场赛事还有 ${reminders.length} 项提醒。是否同时删除提醒？`,
        confirmText: '同时删除', cancelText: '保留提醒', confirmColor: '#c24141',
        success: (result: any) => {
          if (getCurrentUserId() !== owner) return;
          removeFavorite(id);
          if (result.confirm) removeRemindersForEdition(id);
          this.setData({ items: this.data.items.filter((item: any) => item.id !== id) });
          wx.showToast({ title: result.confirm ? '收藏和提醒已删除' : '已取消收藏', icon: 'none' });
        },
      });
      return;
    }
    wx.showModal({
      title: '取消收藏',
      content: '确定将这场赛事移出收藏吗？',
      confirmColor: '#1765d9',
      success: (result: any) => {
        if (!result.confirm || getCurrentUserId() !== owner) return;
        removeFavorite(id);
        this.setData({ items: this.data.items.filter((item: any) => item.id !== id) });
        wx.showToast({ title: '已取消收藏', icon: 'success' });
      },
    });
  },

  // 卡片右上角实心星标（共用模板里叫 onStarTap）= 取消收藏
  onStarTap(event: any) { this.cancelFavorite(event); },

  // 海报加载失败：只把这一张卡片改成文字封面
  onPosterError(event: any) {
    const { id, index } = event.currentTarget.dataset;
    const at = this.data.items[index]?.id === id ? Number(index) : this.data.items.findIndex((item: any) => item.id === id);
    if (at >= 0) this.setData({ [`items[${at}].posterFailed`]: true });
  },

  // 空状态标题旁的“?”：点一下显示说明，再点收起
  toggleEmptyHelp() { this.setData({ emptyHelp: !this.data.emptyHelp }); },
  goFindCompetition() {
    wx.switchTab({ url: '/pages/index/index' });
  },
});
