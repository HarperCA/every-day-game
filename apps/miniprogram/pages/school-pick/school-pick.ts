import { joinSchool, schoolError } from '../../services/schoolContests';
Page({
  data: { code: '', realName: '', college: '', major: '', studentNo: '', working: false, error: '' },
  onLoad(options: Record<string, string>) { this.setData({ code: options.code || '' }); },
  onField(event: { currentTarget: { dataset: { field: string } }, detail: { value: string } }) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value });
  },
  async submit() {
    if (this.data.working) return;
    this.setData({ working: true, error: '' });
    try {
      const { code, realName, college, major, studentNo } = this.data;
      await joinSchool(code, { realName, college, major, studentNo });
      wx.showToast({ title: '已加入学校', icon: 'none' });
      wx.switchTab({ url: '/pages/school/school' });
    } catch (error) { this.setData({ error: schoolError(error) }); }
    finally { this.setData({ working: false }); }
  },
});
