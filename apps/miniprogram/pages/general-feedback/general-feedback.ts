import { feedbackTypes, submitGeneralFeedback } from '../../services/generalFeedback';

Page({
  data: { types: feedbackTypes, typeIndex: 3, content: '', contact: '', submitting: false },
  onTypeChange(event: WechatMiniprogram.PickerChange) { this.setData({ typeIndex: Number(event.detail.value) || 0 }); },
  onContentInput(event: WechatMiniprogram.Input) { this.setData({ content: event.detail.value }); },
  onContactInput(event: WechatMiniprogram.Input) { this.setData({ contact: event.detail.value }); },
  openRecords() { wx.navigateTo({ url: '/pages/feedback-records/feedback-records' }); },
  async submit() {
    if (this.data.submitting) return;
    const content = this.data.content.trim();
    const contact = this.data.contact.trim();
    if (!content) { wx.showToast({ title: '请填写反馈内容', icon: 'none' }); return; }
    if (content.length > 2000) { wx.showToast({ title: '反馈不能超过2000字', icon: 'none' }); return; }
    if (contact.length > 100) { wx.showToast({ title: '联系方式不能超过100字', icon: 'none' }); return; }
    this.setData({ submitting: true });
    try {
      if (!await getApp<any>().requestWechatLogin()) return;
      let appVersion = '';
      try { appVersion = wx.getAccountInfoSync().miniProgram.version || ''; } catch (_error) { /* 开发环境可能无版本 */ }
      await submitGeneralFeedback({ type: feedbackTypes[this.data.typeIndex]?.value || 'other', content, contact, appVersion });
      this.setData({ content: '', contact: '' });
      wx.showModal({ title: '提交成功', content: '反馈已收到，感谢你帮助我们改进竞赛雷达。', confirmText: '查看反馈', cancelText: '继续使用', success: result => { if (result.confirm) this.openRecords(); } });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '提交失败，请稍后重试', icon: 'none' });
    } finally { this.setData({ submitting: false }); }
  },
});
