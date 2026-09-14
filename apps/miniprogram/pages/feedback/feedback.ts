import { callUserData } from '../../services/cloudSession';

const categories = [
  { value: 'time', label: '时间信息' },
  { value: 'registration_link', label: '报名链接' },
  { value: 'eligibility', label: '参赛资格' },
  { value: 'rules', label: '比赛规则' },
  { value: 'other', label: '其他问题' },
];

function decodeQueryValue(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  try { return decodeURIComponent(value) || fallback; }
  catch (_error) { return value; }
}

Page({
  data: {
    editionId: '',
    competitionName: '',
    categories,
    categoryIndex: 0,
    content: '',
    evidenceUrl: '',
    submitting: false,
  },
  onLoad(options: Record<string, string>) {
    this.setData({
      editionId: decodeQueryValue(options.id, ''),
      competitionName: decodeQueryValue(options.name, '当前赛事'),
    });
  },
  onCategoryChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ categoryIndex: Number(event.detail.value) || 0 });
  },
  onContentInput(event: WechatMiniprogram.Input) {
    this.setData({ content: event.detail.value });
  },
  onEvidenceInput(event: WechatMiniprogram.Input) {
    this.setData({ evidenceUrl: event.detail.value });
  },
  async submit() {
    if (this.data.submitting) return;
    const content = this.data.content.trim();
    const evidenceUrl = this.data.evidenceUrl.trim();
    if (!this.data.editionId) { wx.showToast({ title: '缺少赛事标识', icon: 'none' }); return; }
    if (content.length < 5) { wx.showToast({ title: '请至少填写5个字', icon: 'none' }); return; }
    if (content.length > 2000) { wx.showToast({ title: '纠错内容不能超过2000字', icon: 'none' }); return; }
    if (evidenceUrl && !/^https?:\/\//i.test(evidenceUrl)) { wx.showToast({ title: '证据链接需以 http:// 或 https:// 开头', icon: 'none' }); return; }

    try {
      const loggedIn = await getApp<any>().requestWechatLogin();
      if (!loggedIn) return;
      this.setData({ submitting: true });
      await callUserData('submitFeedback', {
        editionId: this.data.editionId,
        competitionName: this.data.competitionName,
        category: categories[this.data.categoryIndex].value,
        content,
        evidenceUrl,
      });
      wx.showModal({
        title: '纠错已提交',
        content: '管理员会核对你提供的说明和证据。审核完成前，赛事页面不会自动改动。',
        showCancel: false,
        success: () => wx.navigateBack(),
      });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '提交失败，请稍后重试', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
