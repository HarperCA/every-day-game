import { ContestView, getContestView, schoolError } from '../../services/schoolContests';
import { contestShareContent } from '../../services/schoolCard';

Page({
  data: { id: '', contest: null as ContestView | null, loading: false, error: '' },
  onLoad(options: Record<string, string>) {
    this.openSignupOnLoad = options.section === 'signup';
    this.setData({ id: options.id || '' });
  },
  onShow() { void this.refresh(); },
  onHide() { this.detailGeneration = (this.detailGeneration || 0) + 1; this.setData({ contest: null }); },
  async refresh() {
    const generation = (this.detailGeneration || 0) + 1;
    this.detailGeneration = generation;
    this.setData({ contest: null, loading: true, error: '' });
    try {
      const contest = await getContestView(this.data.id);
      if (this.detailGeneration !== generation) return;
      if (!contest) this.setData({ error: '这场校赛已下架，或你没有查看权限' });
      else this.setData({ contest }, () => {
        if (this.detailGeneration !== generation || !this.openSignupOnLoad) return;
        this.openSignupOnLoad = false;
        wx.pageScrollTo({ selector: '#school-signup', duration: 0 });
      });
    } catch (error) {
      if (this.detailGeneration === generation) this.setData({ error: schoolError(error) });
    } finally {
      if (this.detailGeneration === generation) this.setData({ loading: false });
    }
  },
  onUnload() { this.detailGeneration = (this.detailGeneration || 0) + 1; },
  copySignup() {
    const signup = this.data.contest?.signup?.trim();
    if (signup) wx.setClipboardData({ data: signup });
  },
  createTeam() {
    const contest = this.data.contest;
    if (contest) wx.navigateTo({ url: `/pages/team-create/team-create?id=${encodeURIComponent(contest.id)}&name=${encodeURIComponent(contest.title)}` });
  },
  onShareAppMessage() {
    return this.data.contest ? contestShareContent(this.data.contest) : { title: '校赛专区', path: '/pages/school/school' };
  },
});
