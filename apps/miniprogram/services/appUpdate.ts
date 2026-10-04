// 新版小程序下载好后提示用户重启升级。微信冷启动时只在后台下载新版，不提示，用户要等下一次冷启动才会用上。
// 只在用户确认后才重启；点“稍后”就继续用当前版本，下次冷启动自然升级。
type UpdateApi = Pick<typeof wx, 'getUpdateManager' | 'showModal'>;

export function watchForUpdate(api: UpdateApi = wx) {
  // 低版本基础库没有这个接口，直接跳过
  if (typeof api.getUpdateManager !== 'function') return;
  const manager = api.getUpdateManager();
  manager.onUpdateReady(() => {
    api.showModal({
      title: '新版本已就绪',
      content: '新版本已下载完成，是否重启小程序完成升级？',
      confirmText: '重启升级',
      cancelText: '稍后',
      success: result => { if (result.confirm) manager.applyUpdate(); },
    });
  });
  // 下载失败不打扰用户，下次冷启动微信会重试
  manager.onUpdateFailed(() => {});
}
