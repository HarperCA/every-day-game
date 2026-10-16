import { REMINDER_TEMPLATE_ID } from './config/cloud';
import { initializeFavoritesCloudSync } from './services/favorites';
import { loginWithWechat } from './services/cloudSession';
import { initializeRemindersCloudSync } from './services/reminders';
import { initClientLog, reportIssue } from './services/clientLog';
import { watchForUpdate } from './services/appUpdate';
import { syncCompetitionPreferencesAfterLogin } from './services/competitionPreferences';

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
    this.globalData.userDataReady = Promise.resolve();
    // 2026-10-09 起打开即用当前微信身份静默登录（微信云开发可静默取得身份，不弹窗），
    // 问卷答案、收藏、提醒都直接存进账号。没有“不登录就不能用”：登录失败照样能浏览，需要时再重试。
    this.login().catch(() => undefined);
    // 访问异常上报：记下网络类型，补发上次没发出去的（clientLog.ts）
    initClientLog();
    // 新版下载好后提示重启升级
    watchForUpdate();
  },
  // 小程序代码报错、没人接住的 Promise 失败，都记一笔
  onError(message: string) {
    reportIssue('js_error', { message: String(message || '').slice(0, 300) });
  },
  onUnhandledRejection(event: any) {
    reportIssue('js_error', { action: 'unhandledRejection', message: String(event?.reason?.message || event?.reason || '').slice(0, 300) });
  },
  // 需要账号的操作（收藏、提醒、纠错）调用：已登录直接通过；启动时的静默登录还在进行就等它；
  // 之前失败了（多半是网络）就再静默登录一次。不再弹确认框。
  async requestWechatLogin() {
    if (this.globalData.loginState === 'success') return true;
    if (this.globalData.loginState === 'loading') await this.globalData.userDataReady.catch(() => undefined);
    else await this.login().catch(() => undefined);
    if (this.globalData.loginState === 'success') return true;
    wx.showToast({ title: '登录失败，请检查网络后重试', icon: 'none' });
    return false;
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
        syncCompetitionPreferencesAfterLogin(),
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
