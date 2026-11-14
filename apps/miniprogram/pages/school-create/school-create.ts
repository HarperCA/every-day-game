import { createContest, schoolError } from '../../services/schoolContests';
Page({
  data: { school: '', title: '', content: '', signup: '', startDate: '', endDate: '', working: false, error: '' },
  onLoad(options: Record<string, string>) {
    try { this.setData({ school: decodeURIComponent(options.school || '') }); }
    catch (_error) { this.setData({ error: '学校参数无效，请返回校赛页重试' }); }
  },
  onField(event: { currentTarget: { dataset: { field: string } }, detail: { value: string } }) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value });
  },
  async submit() {
    if (this.data.working) return;
    this.setData({ working: true, error: '' });
    try {
      const { school, title, content, signup, startDate, endDate } = this.data;
      await createContest({ school, title, content, signup, startDate, endDate });
      wx.showToast({ title: '校赛已提交审核', icon: 'none' });
      wx.navigateBack();
    } catch (error) { this.setData({ error: schoolError(error) }); }
    finally { this.setData({ working: false }); }
  },
});
