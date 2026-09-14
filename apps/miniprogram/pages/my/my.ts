import { getFavoriteRecords } from '../../services/favorites';
import { getReminderRecords } from '../../services/reminders';

Page({
  data: {
    loginState: 'idle',
    loginError: '',
    userIdDisplay: '',
    dataSyncState: 'idle',
    dataSyncError: '',
    favoriteCount: 0,
    reminderCount: 0,
  },
  onShow() {
    const app = getApp<any>();
    this.refreshState();
    const ready = app.globalData.userDataReady;
    if (ready) ready.then(()=>this.refreshState()).catch(()=>this.refreshState());
  },
  refreshState() {
    const app = getApp<any>();
    const userId = app.globalData.userId || '';
    this.setData({
      loginState:app.globalData.loginState,
      loginError:app.globalData.loginError || '',
      userIdDisplay:userId ? `云端账号 ${userId.slice(-8)}` : '',
      dataSyncState:app.globalData.dataSyncState || 'idle',
      dataSyncError:app.globalData.dataSyncError || '',
      favoriteCount:getFavoriteRecords().length,
      reminderCount:getReminderRecords().filter(item=>item.deliveryStatus==='pending').length,
    });
  },
  async requestWechatLogin() {
    const app = getApp<any>();
    this.setData({ loginState:'loading', loginError:'' });
    try { await app.requestWechatLogin(); } catch (_error) { /* 状态由 App 统一维护 */ }
    this.refreshState();
  },
  openFavorites() { wx.navigateTo({ url: '/pages/favorites/favorites' }); },
  openReminders() { wx.navigateTo({ url: '/pages/reminders/reminders' }); },
  openFeedbackHelp() {
    wx.showModal({
      title:'信息纠错',
      content:'请先在“找比赛”中打开具体赛事，再在详情页底部点击“信息纠错”。这样管理员才能准确关联需要复核的赛事。',
      confirmText:'去找比赛',
      cancelText:'知道了',
      success:(result: any) => { if (result.confirm) wx.switchTab({ url:'/pages/index/index' }); },
    });
  },
  openRecommendationGuide() { wx.navigateTo({ url: '/pages/info/info?type=recommendation' }); },
  openPrivacyGuide() { wx.navigateTo({ url: '/pages/info/info?type=privacy' }); },
  openAbout() { wx.navigateTo({ url: '/pages/info/info?type=about' }); },
});
