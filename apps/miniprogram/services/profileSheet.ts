// 昵称头像小面板（2026-11-12）：建队页、队伍页共用。模板 templates/profile-sheet.wxml，样式 templates/profile-sheet.wxss。
// 页面这样接：data 里放 ...profileSheetData，方法里放 ...profileSheetMethods，wxml 里 <template is="profile-sheet" data="{{...profileSheet}}" />。
//   withProfile('方法名')：后端资料里已有昵称就直接调这个方法；没有就先弹面板，保存后再接着调（第一次建队、申请用）。
//   openProfileSheet()：在队伍页改自己的昵称头像，保存后调页面的 onProfileSaved（有的话）。
// 头像用微信“头像昵称填写”能力：button open-type="chooseAvatar" 拿临时头像，input type="nickname" 填昵称。
import { getAccountProfile, saveNicknameAndAvatar } from './accountProfile';

export const profileSheetData = {
  profileSheet: { show: false, nickname: '', avatarPath: '', avatarPreview: '', saving: false, title: '' },
};

const message = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

export const profileSheetMethods = {
  async withProfile(this: any, next: string) {
    let profile = null as null | { nickname: string; avatarUrl: string };
    try { profile = await getAccountProfile(); } catch (_error) { profile = null; }
    // 读不到资料（网络不好）不挡住：照常往下做，后端那边出错会有自己的提示
    if (!profile || profile.nickname) return this[next]();
    this.profileSheetNext = next;
    this.setData({ profileSheet: { show: true, nickname: '', avatarPath: '', avatarPreview: profile.avatarUrl, saving: false, title: '先设置头像和昵称' } });
  },
  async openProfileSheet(this: any) {
    this.profileSheetNext = '';
    let profile = { nickname: '', avatarUrl: '' };
    try { profile = await getAccountProfile(); } catch (error) { wx.showToast({ title: message(error, '读取失败'), icon: 'none' }); return; }
    this.setData({ profileSheet: { show: true, nickname: profile.nickname, avatarPath: '', avatarPreview: profile.avatarUrl, saving: false, title: '修改头像和昵称' } });
  },
  closeProfileSheet(this: any) {
    this.profileSheetNext = '';
    this.setData({ 'profileSheet.show': false });
  },
  onChooseAvatar(this: any, event: any) {
    const path = event?.detail?.avatarUrl || '';
    if (path) this.setData({ 'profileSheet.avatarPath': path, 'profileSheet.avatarPreview': path });
  },
  // type="nickname" 的输入框：微信键盘上选的昵称要等失焦才稳定，所以 input 和 blur 都接
  onNicknameInput(this: any, event: any) {
    this.setData({ 'profileSheet.nickname': event?.detail?.value ?? '' });
  },
  async saveProfileSheet(this: any) {
    const sheet = this.data.profileSheet;
    if (sheet.saving) return;
    if (!String(sheet.nickname || '').trim()) { wx.showToast({ title: '请填写昵称', icon: 'none' }); return; }
    this.setData({ 'profileSheet.saving': true });
    try {
      const saved = await saveNicknameAndAvatar({ nickname: sheet.nickname, avatarPath: sheet.avatarPath });
      this.setData({ 'profileSheet.show': false, 'profileSheet.saving': false });
      if (saved.avatarFailed) wx.showToast({ title: '头像暂时传不上去，先用默认头像', icon: 'none' });
      const next = this.profileSheetNext;
      this.profileSheetNext = '';
      if (next) await this[next]();
      else await this.onProfileSaved?.();
    } catch (error) {
      this.setData({ 'profileSheet.saving': false });
      wx.showToast({ title: message(error, '保存失败'), icon: 'none' });
    }
  },
  noop() {},
};
