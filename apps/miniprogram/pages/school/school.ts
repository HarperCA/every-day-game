import { ContestView, SchoolMember, SchoolStatus, confirmSchoolAction, createInvite, getSchoolStatus, invitePath, leaveSchool, listContests, listManagedContests, listMembers, removeMember, schoolError, withdrawContest } from '../../services/schoolContests';

Page({
  data: {
    status: null as SchoolStatus | null, contests: [] as ContestView[], adminSchool: '', inviteCode: '',
    members: [] as SchoolMember[], managed: [] as ContestView[], loading: false, working: false, error: '',
  },
  onShow() { void this.refresh(); },
  async refresh(school?: string) {
    const generation = (this.schoolGeneration || 0) + 1;
    this.schoolGeneration = generation;
    this.setData({ status: null, contests: [], members: [], managed: [], inviteCode: '', loading: true, error: '' });
    try {
      const [status, contests] = await Promise.all([getSchoolStatus(), listContests()]);
      if (this.schoolGeneration !== generation) return;
      const preferred = school ?? this.data.adminSchool;
      const adminSchool = status.adminSchools.includes(preferred) ? preferred : status.adminSchools[0] || '';
      this.setData({ status, contests, adminSchool });
      if (adminSchool) {
        const [members, managed] = await Promise.all([listMembers(adminSchool), listManagedContests(adminSchool)]);
        if (this.schoolGeneration === generation) this.setData({ members, managed });
      }
    } catch (error) {
      if (this.schoolGeneration === generation) this.setData({ error: schoolError(error) });
    } finally {
      if (this.schoolGeneration === generation) this.setData({ loading: false });
    }
  },
  onHide() {
    this.schoolGeneration = (this.schoolGeneration || 0) + 1;
    this.setData({ status: null, contests: [], members: [], managed: [], inviteCode: '' });
  },
  retry() { void this.refresh(); },
  switchSchool(event: WechatMiniprogram.PickerChange) {
    void this.refresh(this.data.status?.adminSchools[Number(event.detail.value)]);
  },
  openApply() { wx.navigateTo({ url: '/pages/school-apply/school-apply' }); },
  openCreate() {
    wx.navigateTo({ url: `/pages/school-create/school-create?school=${encodeURIComponent(this.data.adminSchool)}` });
  },
  openContest(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: `/pages/school-detail/school-detail?id=${encodeURIComponent(String(event.currentTarget.dataset.id))}` });
  },
  async changeInvite(event: WechatMiniprogram.TouchEvent) {
    if (this.data.working || !this.data.adminSchool) return;
    const school = this.data.adminSchool;
    const generation = this.schoolGeneration;
    this.setData({ working: true });
    try {
      const renew = event.currentTarget.dataset.renew === 'yes';
      if (renew && !await confirmSchoolAction('更换后，已经发出的旧邀请将失效。')) return;
      const invite = await createInvite(school, renew);
      if (this.schoolGeneration === generation) this.setData({ inviteCode: invite.inviteCode });
    } catch (error) { wx.showToast({ title: schoolError(error), icon: 'none' }); }
    finally { this.setData({ working: false }); }
  },
  async confirmChange(event: WechatMiniprogram.TouchEvent) {
    if (this.data.working) return;
    const { action, id, school } = event.currentTarget.dataset;
    const adminSchool = this.data.adminSchool;
    const generation = this.schoolGeneration;
    this.setData({ working: true });
    try {
      const question = action === 'withdraw' ? '确认下架这场校赛？' : action === 'remove' ? '确认将这位学生移出学校？' : '确认退出学校并删除你的加入资料？';
      if (!await confirmSchoolAction(question) || this.schoolGeneration !== generation) return;
      if (action === 'withdraw') await withdrawContest(String(id));
      else if (action === 'remove') await removeMember(adminSchool, String(id));
      else await leaveSchool(String(school));
      if (this.schoolGeneration === generation) await this.refresh(adminSchool);
    } catch (error) { wx.showToast({ title: schoolError(error), icon: 'none' }); }
    finally { this.setData({ working: false }); }
  },
  onShareAppMessage(event: { from: string }) {
    if (event.from === 'button' && this.data.inviteCode) {
      return { title: `加入${this.data.adminSchool}校赛专区`, path: invitePath(this.data.inviteCode) };
    }
    return { title: '校赛专区', path: '/pages/school/school' };
  },
});
