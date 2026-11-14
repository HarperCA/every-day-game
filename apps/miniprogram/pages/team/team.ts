// 组队页（2026-11-05；11-12 接北京后端）：上面是“创建队伍”“组队申请”两个方框按钮，下面是我参加的队伍，可按全部、我发起的、我参加的筛选。
// 每次进来从后端读 listMyTeams、listPendingForMe，队长、队员看到的是同一份。
import { listInboundApplications, listMyTeams, requestApplyNotice } from '../../services/teams';
import type { TeamView } from '../../services/teams';
import { teamShareContent } from '../../services/teamCard';

const TAB_INDEX = 2;   // 底部导航里“组队”是第 3 项，红点要用
type Filter = 'all' | 'initiated' | 'joined';

function ofFilter(teams: TeamView[], filter: Filter) {
  if (filter === 'initiated') return teams.filter(team => team.role === 'captain');
  if (filter === 'joined') return teams.filter(team => team.role === 'member');
  return teams;
}

Page({
  data: { filter: 'all' as Filter, all: [] as TeamView[], teams: [] as TeamView[], counts: { all: 0, initiated: 0, joined: 0 }, isEmpty: false, inboundCount: 0, loading: true, error: '' },
  onShow() { return this.refresh(); },
  async refresh() {
    try {
      const [all, inbound] = await Promise.all([listMyTeams(), listInboundApplications().catch(() => [])]);
      this.setData({ all, error: '', loading: false, isEmpty: all.length === 0, inboundCount: inbound.length });
      this.applyFilter();
      if (inbound.length) wx.showTabBarRedDot({ index: TAB_INDEX });
      else wx.hideTabBarRedDot({ index: TAB_INDEX });
      // 队长进组队页：请用户订阅“有人申请”的通知（模板编号为空时什么都不做）。
      // 注意微信要求在点按里调，进页面时调真机上会被拒；模板申请下来后要改到点按里（见报告）。
      if (all.some(team => team.role === 'captain')) requestApplyNotice();
    } catch (error) {
      this.setData({ loading: false, error: error instanceof Error ? error.message : '加载失败' });
    }
  },
  applyFilter() {
    const all = this.data.all;
    this.setData({
      teams: ofFilter(all, this.data.filter),
      counts: { all: all.length, initiated: ofFilter(all, 'initiated').length, joined: ofFilter(all, 'joined').length },
    });
  },
  setFilter(event: WechatMiniprogram.TouchEvent) {
    this.setData({ filter: event.currentTarget.dataset.filter as Filter }, () => this.applyFilter());
  },
  noop() {},
  findTeam(id: string): TeamView | undefined { return this.data.all.find((team: TeamView) => team.id === id); },
  openTeam(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: `/pages/team-detail/team-detail?id=${encodeURIComponent(String(event.currentTarget.dataset.id))}` });
  },
  openApplications() { wx.navigateTo({ url: '/pages/team-applications/team-applications' }); },
  createTeam() { wx.navigateTo({ url: '/pages/team-create/team-create' }); },
  copyWechat(event: WechatMiniprogram.TouchEvent) {
    const wechat = this.findTeam(String(event.currentTarget.dataset.id))?.captainWechat;
    if (wechat) wx.setClipboardData({ data: wechat });
    else wx.showToast({ title: '队长还没填微信号', icon: 'none' });
  },
  // 卡片里的转发按钮转那支队；右上角菜单没有指定队伍，转小程序首页
  onShareAppMessage(res: any) {
    const team = res?.from === 'button' ? this.findTeam(String(res.target?.dataset?.id)) : null;
    return team ? teamShareContent(team) : { title: '竞赛雷达', path: '/pages/index/index' };
  },
});
