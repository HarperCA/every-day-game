import { getCompetition } from '../../services/repository';
import { getFavoriteRecords, removeFavorite } from '../../services/favorites';
import { getRemindersForEdition, removeRemindersForEdition } from '../../services/reminders';

Page({
  data: {
    items: [] as any[],
    loading: true,
    error: '',
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const ready = getApp<any>().globalData.userDataReady;
      if (ready) await ready.catch(() => undefined);
      const records = getFavoriteRecords();
      const results = await Promise.all(records.map(async (record) => {
        try {
          const item = await getCompetition(record.editionId);
          return {
            ...item,
            favoriteAt: record.createdAt.substring(0, 10),
            isEnded: item.dataStatus === 'archived' || item.registrationStatus === '已截止',
          };
        } catch (_error) {
          return null;
        }
      }));
      this.setData({ items: results.filter(Boolean), loading: false });
    } catch (error) {
      this.setData({
        loading: false,
        error: error instanceof Error ? error.message : '收藏加载失败',
      });
    }
  },

  retry() {
    this.load();
  },

  openDetail(event: any) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${event.currentTarget.dataset.id}` });
  },

  cancelFavorite(event: any) {
    const id = event.currentTarget.dataset.id;
    const reminders = getRemindersForEdition(id);
    if (reminders.length) {
      wx.showModal({
        title: '取消收藏',
        content: `这场赛事还有 ${reminders.length} 项提醒。是否同时删除提醒？`,
        confirmText: '同时删除', cancelText: '保留提醒', confirmColor: '#c24141',
        success: (result: any) => {
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
      confirmColor: '#087e8b',
      success: (result: any) => {
        if (!result.confirm) return;
        removeFavorite(id);
        this.setData({ items: this.data.items.filter((item: any) => item.id !== id) });
        wx.showToast({ title: '已取消收藏', icon: 'success' });
      },
    });
  },

  goFindCompetition() {
    wx.switchTab({ url: '/pages/index/index' });
  },
});
