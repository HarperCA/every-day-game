import { ContestView, SchoolMember, SchoolStatus, confirmSchoolAction, createInvite, getSchoolStatus, invitePath, leaveSchool, listContests, listManagedContests, listMembers, removeMember, schoolError, withdrawContest } from '../../services/schoolContests';
import { SCHOOL_NAMES } from '../../services/schoolList';

const ALL_SCHOOLS = '全部学校';
const SCHOOL_PAGE_SIZE = 50;
const schoolNames = [...new Set(SCHOOL_NAMES)];

Page({
  data: {
    status: null as SchoolStatus | null, contests: [] as ContestView[], adminSchool: '', inviteCode: '', studentView: true,
    pickerStep: '' as '' | 'school' | 'contest', schoolQuery: '', schoolOptions: [] as string[],
    moreSchools: false, selectedSchool: '', schoolLabel: ALL_SCHOOLS, visibleContests: [] as ContestView[],
    universitySelected: false, selectedAdminUniversity: '',
    members: [] as SchoolMember[], managed: [] as ContestView[], selectedManagedId: '', loading: false, working: false, error: '',
  },
  onShow() { void this.refresh(); },
  async refresh(school?: string, showManagedChoices = false) {
    const generation = (this.schoolGeneration || 0) + 1;
    this.schoolGeneration = generation;
    this.setData({ status: null, contests: [], visibleContests: [], pickerStep: '', members: [], managed: [], selectedManagedId: '', inviteCode: '', loading: true, error: '' });
    try {
      const [status, contests] = await Promise.all([getSchoolStatus(), listContests()]);
      if (this.schoolGeneration !== generation) return;
      const preferred = school ?? this.data.adminSchool;
      const adminSchool = status.adminSchools.includes(preferred) ? preferred : status.adminSchools[0] || '';
      const { selectedSchool } = this.data;
      const visibleContests = selectedSchool ? contests.filter(contest => contest.school === selectedSchool) : contests;
      const studentView = this.data.studentView || !adminSchool;
      const selectedAdminUniversity = this.data.selectedAdminUniversity === adminSchool ? adminSchool : '';
      this.setData({ status, contests, visibleContests, adminSchool, studentView, selectedAdminUniversity });
      if (!studentView) {
        const [members, managed] = await Promise.all([listMembers(adminSchool), listManagedContests(adminSchool)]);
        if (this.schoolGeneration === generation) {
          this.setData({ members, managed, pickerStep: showManagedChoices ? 'contest' : '' });
        }
      }
    } catch (error) {
      if (this.schoolGeneration === generation) this.setData({ error: schoolError(error) });
    } finally {
      if (this.schoolGeneration === generation) this.setData({ loading: false });
    }
  },
  onHide() {
    this.schoolGeneration = (this.schoolGeneration || 0) + 1;
    this.setData({ status: null, contests: [], visibleContests: [], pickerStep: '', members: [], managed: [], inviteCode: '' });
  },
  retry() { void this.refresh(); },
  toggleStudentView() {
    if (!this.data.adminSchool || this.data.loading || this.data.working) return;
    if (this.data.studentView) {
      this.setData({ studentView: false });
      void this.refresh();
    } else {
      this.setData({ studentView: true, members: [], managed: [], inviteCode: '' });
    }
  },
  toggleContestPicker() {
    if (this.data.loading || this.data.working) return;
    if (this.data.pickerStep) this.setData({ pickerStep: '' });
    else this.openSchoolChoices();
  },
  openSchoolChoices() {
    this.setData({ pickerStep: 'school' });
    this.updateSchoolOptions('', SCHOOL_PAGE_SIZE);
  },
  searchSchools(event: WechatMiniprogram.Input) {
    this.updateSchoolOptions(event.detail.value, SCHOOL_PAGE_SIZE);
  },
  showMoreSchools() {
    if (this.data.moreSchools) this.updateSchoolOptions(this.data.schoolQuery, this.data.schoolOptions.length + SCHOOL_PAGE_SIZE);
  },
  updateSchoolOptions(schoolQuery: string, limit: number) {
    const query = schoolQuery.trim().toLowerCase();
    const options = this.data.studentView ? schoolNames : this.data.status?.adminSchools ?? [];
    const matches = query ? options.filter(school => school.toLowerCase().includes(query)) : options;
    this.setData({ schoolQuery, schoolOptions: matches.slice(0, limit), moreSchools: matches.length > limit });
  },
  selectSchoolFilter(event: WechatMiniprogram.TouchEvent) {
    const selectedSchool = event.currentTarget.dataset.school || '';
    if (!this.data.studentView) {
      if (this.data.loading || this.data.working || !this.data.status?.adminSchools.includes(selectedSchool)) return;
      this.setData({ selectedAdminUniversity: selectedSchool });
      if (selectedSchool === this.data.adminSchool) this.setData({ pickerStep: 'contest', selectedManagedId: '' });
      else void this.refresh(selectedSchool, true);
      return;
    }
    const { contests } = this.data;
    const visibleContests = selectedSchool ? contests.filter(contest => contest.school === selectedSchool) : contests;
    this.setData({ selectedSchool, schoolLabel: selectedSchool || ALL_SCHOOLS, universitySelected: true, visibleContests, pickerStep: 'contest' });
  },
  openApply() { wx.navigateTo({ url: '/pages/school-apply/school-apply' }); },
  openCreate() {
    wx.navigateTo({ url: `/pages/school-create/school-create?school=${encodeURIComponent(this.data.adminSchool)}` });
  },
  openContest(event: WechatMiniprogram.TouchEvent) {
    const { id, signup } = event.currentTarget.dataset;
    if (!id) return;
    this.navigateToContest(String(id), String(signup) === 'true');
  },
  selectPickerContest(event: WechatMiniprogram.TouchEvent) {
    if (this.data.studentView) {
      this.openContest(event);
      return;
    }
    const id = event.currentTarget.dataset.id;
    if (!this.data.managed.some(contest => contest.id === id)) return;
    this.setData({ selectedManagedId: id, pickerStep: '' }, () => {
      wx.pageScrollTo({ selector: '#sc-selected-managed', duration: 200 });
    });
  },
  navigateToContest(id: string, showSignup = false) {
    const section = showSignup ? '&section=signup' : '';
    wx.navigateTo({ url: `/pages/school-detail/school-detail?id=${encodeURIComponent(id)}${section}` });
  },
  async changeInvite(event: WechatMiniprogram.TouchEvent) {
    if (this.data.working || this.data.studentView || !this.data.adminSchool) return;
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
