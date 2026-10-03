import { REMINDER_TEMPLATE_ID } from './config/cloud';
import { initializeFavoritesCloudSync } from './services/favorites';
import { loginWithWechat } from './services/cloudSession';
import { initializeRemindersCloudSync } from './services/reminders';
import { initClientLog, reportIssue } from './services/clientLog';

App({
  globalData: {
    loginState: 'idle',
    userId: '',
    loginError: '',
    dataSyncState: 'idle',
    dataSyncError: '',
    reminderTemplateId: REMINDER_TEMPLATE_ID,
    userDataReady: Promise.resolve(),
  },
  onLaunch() {
    // 微信云开发可静默取得 openid。这里不在启动时自动登录，必须由用户点击并确认。
    this.globalData.userDataReady = Promise.resolve();
    // 访问异常上报：记下网络类型，补发上次没发出去的（clientLog.ts）
    initClientLog();
  },
  // 小程序代码报错、没人接住的 Promise 失败，都记一笔
  onError(message: string) {
    reportIssue('js_error', { message: String(message || '').slice(0, 300) });
  },
  onUnhandledRejection(event: any) {
    reportIssue('js_error', { action: 'unhandledRejection', message: String(event?.reason?.message || event?.reason || '').slice(0, 300) });
  },
  async requestWechatLogin() {
    if (this.globalData.loginState === 'success') return true;
    const confirmed = await new Promise<boolean>((resolve) => {
      wx.showModal({
        title: '微信登录',
        content: '登录后会使用当前微信身份保存并同步你的收藏和赛事提醒。不采集手机号、真实姓名、学校或学号。',
        confirmText: '微信登录',
        cancelText: '暂不登录',
        success: result => resolve(Boolean(result.confirm)),
        fail: () => resolve(false),
      });
    });
    if (!confirmed) {
      this.globalData.loginState = 'idle';
      this.globalData.loginError = '';
      return false;
    }
    await this.login();
    return true;
  },
  async login() {
    this.globalData.loginState = 'loading';
    this.globalData.loginError = '';
    this.globalData.dataSyncState = 'idle';
    this.globalData.dataSyncError = '';
    const task = (async () => {
      const result = await loginWithWechat();
      this.globalData.userId = result.userId;
      this.globalData.loginState = 'success';
      this.globalData.dataSyncState = 'loading';
      const syncResults = await Promise.allSettled([
        initializeFavoritesCloudSync(),
        initializeRemindersCloudSync(),
      ]);
      const failures = syncResults.filter((item) => item.status === 'rejected') as PromiseRejectedResult[];
      if (failures.length) {
        this.globalData.dataSyncState = 'partial';
        this.globalData.dataSyncError = failures
          .map((item) => item.reason instanceof Error ? item.reason.message : String(item.reason))
          .join('；');
        console.error('用户数据云同步未完全成功', failures.map((item) => item.reason));
      } else {
        this.globalData.dataSyncState = 'success';
      }
    })();
    this.globalData.userDataReady = task;
    try {
      await task;
    } catch (error) {
      reportIssue('user_data_failed', { action: 'login', message: error instanceof Error ? error.message : String(error) });
      this.globalData.loginState = 'failed';
      this.globalData.userId = '';
      this.globalData.loginError = error instanceof Error ? error.message : '微信登录失败';
      throw error;
    }
  },
});
