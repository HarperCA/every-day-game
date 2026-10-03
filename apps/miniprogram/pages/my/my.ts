import { getFavoriteRecords } from '../../services/favorites';
import { getReminderRecords } from '../../services/reminders';
import { getUserProfile } from '../../services/profile';

Page({
  data: {
    loginState: 'idle',
    loginError: '',
    dataSyncState: 'idle',
    dataSyncError: '',
    profileName: '微信用户',
    avatarPath: '',
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
    const loggedIn = app.globalData.loginState === 'success';
    const profile = getUserProfile();
    this.setData({
      loginState:app.globalData.loginState,
      loginError:app.globalData.loginError || '',
      dataSyncState:app.globalData.dataSyncState || 'idle',
      dataSyncError:app.globalData.dataSyncError || '',
      profileName:profile.displayName,
      avatarPath:profile.avatarPath,
      favoriteCount:loggedIn ? getFavoriteRecords().length : 0,
      reminderCount:loggedIn ? getReminderRecords().length : 0,
    });
  },
  async requestWechatLogin() {
    const app = getApp<any>();
    this.setData({ loginState:'loading', loginError:'' });
    try { await app.requestWechatLogin(); } catch (_error) { /* 状态由 App 统一维护 */ }
    this.refreshState();
  },
  async openFavorites() {
    if (!await this.ensureWechatLogin()) return;
    wx.navigateTo({ url: '/pages/favorites/favorites' });
  },
  async openReminders() {
    if (!await this.ensureWechatLogin()) return;
    wx.navigateTo({ url: '/pages/reminders/reminders' });
  },
  async openProfile() {
    if (!await this.ensureWechatLogin()) return;
    wx.navigateTo({ url: '/pages/profile/profile' });
  },
  async ensureWechatLogin(): Promise<boolean> {
    try {
      const loggedIn = await getApp<any>().requestWechatLogin();
      this.refreshState();
      return loggedIn;
    } catch (_error) {
      this.refreshState();
      return false;
    }
  },
  openFeedback() { wx.navigateTo({ url: '/pages/feedback/feedback' }); },
  openRecommendationGuide() { wx.navigateTo({ url: '/pages/info/info?type=recommendation' }); },
  openPrivacyGuide() { wx.navigateTo({ url: '/pages/info/info?type=privacy' }); },
  openAbout() { wx.navigateTo({ url: '/pages/info/info?type=about' }); },
});
