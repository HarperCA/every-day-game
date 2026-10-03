import { getUserProfile, saveUserProfile } from '../../services/profile';
import { isCloudSessionReady } from '../../services/cloudSession';

Page({
  data: {
    displayName: '',
    avatarPath: '',
    pendingAvatarPath: '',
    saving: false,
  },
  onLoad() {
    if (!isCloudSessionReady()) {
      wx.showToast({ title: '请先微信登录', icon: 'none' });
      wx.navigateBack();
      return;
    }
    const profile = getUserProfile();
    this.setData({ displayName: profile.displayName, avatarPath: profile.avatarPath });
  },
  onChooseAvatar(event: any) {
    const avatarPath = String(event.detail?.avatarUrl || '');
    if (avatarPath) this.setData({ avatarPath, pendingAvatarPath: avatarPath });
  },
  onNameInput(event: WechatMiniprogram.Input) {
    this.setData({ displayName: event.detail.value });
  },
  async save(event: any) {
    if (this.data.saving) return;
    const displayName = String(event.detail?.value?.displayName ?? this.data.displayName).trim();
    if (!displayName || Array.from(displayName).length > 20) {
      wx.showToast({ title: '名称请填写 1～20 个字', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    try {
      let avatarPath = this.data.avatarPath;
      if (this.data.pendingAvatarPath) {
        avatarPath = await new Promise<string>((resolve, reject) => {
          wx.saveFile({
            tempFilePath: this.data.pendingAvatarPath,
            success: result => resolve(result.savedFilePath),
            fail: reject,
          });
        });
      }
      saveUserProfile({ displayName, avatarPath });
      wx.showToast({ title: '已保存', icon: 'success' });
      wx.navigateBack();
    } catch (_error) {
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },
});
