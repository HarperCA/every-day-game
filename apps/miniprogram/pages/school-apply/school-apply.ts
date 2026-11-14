import { applyManager, schoolError } from '../../services/schoolContests';
Page({
  data: { school: '', realName: '', contact: '', proof: '', working: false, error: '' },
  onField(event: { currentTarget: { dataset: { field: string } }, detail: { value: string } }) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value });
  },
  async submit() {
    if (this.data.working) return;
    this.setData({ working: true, error: '' });
    try {
      const { school, realName, contact, proof } = this.data;
      await applyManager({ school, realName, contact, proof });
      wx.showToast({ title: '已提交，等待审核', icon: 'none' });
      wx.navigateBack();
    } catch (error) { this.setData({ error: schoolError(error) }); }
    finally { this.setData({ working: false }); }
  },
});
