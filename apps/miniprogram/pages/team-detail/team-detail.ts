// 队伍页（2026-11-05；11-12 接北京后端）：群里点转发卡片、组队页点队伍都进这里，每次从后端读。按身份显示：
//   队长：待审条数（点进申请页）、邀请卡片、队员（转让、移出）、管理队伍（改队名、改人数、补填/修改微信号）、解散；
//         转让过来还没有微信号时顶上提示他填。
//   队员：组队成功、队长微信（复制）、队友和队长的昵称头像、退出队伍。
//   外人：只有简版（比赛名、队名、人数上限、已有几人）；申请过的看审核中（可撤回）或未通过；能申请的填专业、年级（必填）、擅长方向、介绍（选填）。
//   第一次申请、后端还没有昵称时先弹昵称头像面板；队员在这里也能改自己的昵称头像。
import {
  applyToTeam, checkApplyInput, disbandTeam, getTeamView, leaveTeam, listInboundApplications, MAX_MEMBERS, MIN_MEMBERS,
  removeMember, renameTeam, setMaxMembers, setWechat, transferCaptain, withdrawApplication,
} from '../../services/teams';
import type { TeamView } from '../../services/teams';
import { drawTeamCard, STATIC_CARD_IMAGE, teamShareContent } from '../../services/teamCard';
import { isCampusContest } from '../../services/schoolContests';
import { profileSheetData, profileSheetMethods } from '../../services/profileSheet';

function decodeQueryValue(value: string): string {
  try { return decodeURIComponent(value); } catch (_error) { return value; }
}
const errorText = (error: unknown) => (error instanceof Error && error.message ? error.message : '操作失败');
function confirmModal(title: string, confirmText: string, content = ''): Promise<boolean> {
  return new Promise(resolve => wx.showModal({ title, content, confirmText, confirmColor: '#c24141', success: (result: any) => resolve(Boolean(result?.confirm)), fail: () => resolve(false) }));
}
// 改人数的选项：不能少于现在的人数
const sizesFrom = (memberCount: number) => Array.from({ length: MAX_MEMBERS - Math.max(MIN_MEMBERS, memberCount) + 1 }, (_, index) => `${index + Math.max(MIN_MEMBERS, memberCount)} 人`);

Page({
  data: {
    id: '', team: null as TeamView | null, notFound: false, loading: true, error: '',
    form: { major: '', grade: '', strengths: '', intro: '' },
    edit: { name: '', wechat: '' },
    sizeOptions: [] as string[], sizeIndex: 0, pendingCount: 0,
    cardImage: STATIC_CARD_IMAGE, busy: false,
    ...profileSheetData,
  },
  ...profileSheetMethods,
  onLoad(options: Record<string, string>) {
    this.setData({ id: decodeQueryValue(options.id || '') });
  },
  onShow() { return this.refresh(); },
  async refresh() {
    let team: TeamView | null;
    try { team = await getTeamView(this.data.id); } catch (error) {
      this.setData({ loading: false, error: errorText(error) });
      return;
    }
    if (!team) { this.setData({ team: null, notFound: true, loading: false, error: '' }); return; }
    const sizeOptions = sizesFrom(team.memberCount);
    this.setData({
      team, notFound: false, loading: false, error: '',
      edit: { name: team.rawName, wechat: team.captainWechat },
      sizeOptions, sizeIndex: Math.max(0, sizeOptions.indexOf(`${team.maxMembers} 人`)),
    });
    if (team.role === 'captain') {
      drawTeamCard(team).then(cardImage => this.setData({ cardImage }));
      try {
        const pending = await listInboundApplications();
        this.setData({ pendingCount: pending.filter(item => item.teamId === team!.id).length });
      } catch (_error) { this.setData({ pendingCount: 0 }); }
    }
  },
  openCompetition() {
    const id = this.data.team?.competitionId;
    if (!id) return;
    if (isCampusContest(id)) { wx.navigateTo({ url: `/pages/school-detail/school-detail?id=${encodeURIComponent(id)}` }); return; }
    // 刚从这场比赛的详情页过来就直接返回，来回点不会把页面越叠越深（微信最多 10 层）
    const pages = getCurrentPages();
    const previous = pages[pages.length - 2];
    if (previous?.route === 'pages/detail/detail' && previous.data?.item?.id === id) { wx.navigateBack(); return; }
    wx.navigateTo({ url: `/pages/detail/detail?id=${encodeURIComponent(id)}` });
  },
  openApplications() { wx.navigateTo({ url: '/pages/team-applications/team-applications' }); },
  onField(event: any) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value }); },
  onEdit(event: any) { this.setData({ [`edit.${event.currentTarget.dataset.field}`]: event.detail.value }); },
  // 做一件事：成功提示、刷新；失败提示后端报错的中文
  async attempt(action: () => Promise<unknown>, done: string) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      await action();
      await this.refresh();
      wx.showToast({ title: done, icon: 'none' });
    } catch (error) { wx.showToast({ title: errorText(error), icon: 'none' }); }
    this.setData({ busy: false });
  },

  // ---- 外人：申请、撤回 ----
  apply() {
    const problem = checkApplyInput(this.data.form);
    if (problem) { wx.showToast({ title: problem, icon: 'none' }); return Promise.resolve(); }
    return this.withProfile('applyNow');
  },
  applyNow() { return this.attempt(() => applyToTeam(this.data.id, this.data.form), '申请已发送'); },
  async withdraw() {
    const applicationId = this.data.team?.applicationId;
    if (!applicationId) return;
    if (await confirmModal('撤回这条申请？', '撤回')) await this.attempt(() => withdrawApplication(applicationId), '已撤回');
  },

  // ---- 队长：改队名、改人数、微信号、转让、移出、解散 ----
  saveName() { return this.attempt(() => renameTeam(this.data.id, this.data.edit.name), '队名已保存'); },
  onSizeChange(event: WechatMiniprogram.PickerChange) {
    const size = parseInt(this.data.sizeOptions[Number(event.detail.value)], 10);
    if (!size || size === this.data.team?.maxMembers) return Promise.resolve();
    return this.attempt(() => setMaxMembers(this.data.id, size), `人数改为 ${size} 人`);
  },
  saveWechat() { return this.attempt(() => setWechat(this.data.id, this.data.edit.wechat), '微信号已保存'); },
  async removeMember(event: WechatMiniprogram.TouchEvent) {
    const userId = String(event.currentTarget.dataset.id);
    if (await confirmModal('把这位队员移出队伍？', '移出')) await this.attempt(() => removeMember(this.data.id, userId), '已移出，空位已开放');
  },
  async transfer(event: WechatMiniprogram.TouchEvent) {
    const { id, name } = event.currentTarget.dataset;
    const ok = await confirmModal(`把队长转给${name || '这位队员'}？`, '转让', '转让后你变成队员。你的微信号不会留给新队长，新队长要自己补填。');
    if (ok) await this.attempt(() => transferCaptain(this.data.id, String(id)), '已转让，请提醒新队长补填微信号');
  },
  async dissolve() {
    const ok = await confirmModal('解散这支队伍？', '解散', '解散后队伍直接删除，队员都会退出，待审核的申请也会清空，转发出去的卡片打不开。不能撤销。');
    if (!ok) return;
    try {
      await disbandTeam(this.data.id);
      wx.showToast({ title: '队伍已解散', icon: 'none' });
      wx.switchTab({ url: '/pages/team/team' });
    } catch (error) { wx.showToast({ title: errorText(error), icon: 'none' }); }
  },

  // ---- 队员：退出、复制队长微信 ----
  async leave() {
    if (!(await confirmModal('退出这支队伍？', '退出', '退出后要重新申请才能回来。'))) return;
    try {
      await leaveTeam(this.data.id);
      wx.showToast({ title: '已退出队伍', icon: 'none' });
      wx.switchTab({ url: '/pages/team/team' });
    } catch (error) { wx.showToast({ title: errorText(error), icon: 'none' }); }
  },
  copyWechat() {
    const wechat = this.data.team?.captainWechat;
    if (wechat) wx.setClipboardData({ data: wechat });
    else wx.showToast({ title: '队长还没填微信号', icon: 'none' });
  },

  // ---- 改自己的昵称头像（面板逻辑在 services/profileSheet.ts） ----
  editMyProfile() { return this.openProfileSheet(); },
  onProfileSaved() { return this.refresh(); },

  // 转发卡片：页面上的按钮和右上角菜单都走这里；路径带队伍编号
  onShareAppMessage() {
    const team = this.data.team;
    return team ? teamShareContent(team) : { title: '竞赛雷达', path: '/pages/index/index' };
  },
});
