// 创建队伍（2026-11-05；11-12 接北京后端）：从比赛详情来时比赛已选好；从组队页来时要搜索选比赛。
// 填队名、人数（2–15）、队长微信号（11-12 改必填，空着提示、不发请求）。第一次建队、后端还没有昵称时先弹昵称头像面板。创建后进队伍页转发卡片。
import { checkCreateInput, createTeam, MAX_MEMBERS, MIN_MEMBERS, requestApplyNotice } from '../../services/teams';
import { getCompetition } from '../../services/repository';
import { getContestView, isCampusContest } from '../../services/schoolContests';
import { profileSheetData, profileSheetMethods } from '../../services/profileSheet';

const DEFAULT_SIZE = 4;

// 比赛名里可能有 %，解码失败就用原文，不能让页面打不开
function decodeQueryValue(value: string): string {
  try { return decodeURIComponent(value); } catch (_error) { return value; }
}

// 级别和截止时间只是记下来，不显示，也不交给后端
function fromCompetition(item: any) {
  return { competitionId: item.id, competitionName: item.name, competitionLevel: item.eventLevel || '', registrationEnd: item.registrationEnd || '' };
}

Page({
  data: {
    fromCompetition: false, competitionId: '', competitionName: '', competitionLevel: '', registrationEnd: '',
    name: '', wechat: '', submitting: false,
    sizeOptions: Array.from({ length: MAX_MEMBERS - MIN_MEMBERS + 1 }, (_, index) => `${index + MIN_MEMBERS} 人`),
    sizeIndex: DEFAULT_SIZE - MIN_MEMBERS,
    ...profileSheetData,
  },
  ...profileSheetMethods,
  async onLoad(options: Record<string, string>) {
    if (!options.id) return;
    const id = decodeQueryValue(options.id);
    this.setData({ fromCompetition: true, competitionId: id, competitionName: decodeQueryValue(options.name || '') });
    if (isCampusContest(id)) {
      try {
        const contest = await getContestView(id);
        if (contest) this.setData({ competitionName: contest.title, competitionLevel: '校赛' });
      } catch (_error) { /* 保留校赛详情传来的标题，建队时由后端重新校验。 */ }
      return;
    }
    try { this.setData(fromCompetition(await getCompetition(id))); } catch (_error) { /* 留着详情页带来的名字 */ }
  },
  pickCompetition() {
    if (!this.data.fromCompetition) wx.navigateTo({ url: '/pages/team-pick/team-pick' });
  },
  onCompetitionPicked(item: any) { this.setData(fromCompetition(item)); },
  onField(event: any) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }); },
  onSizeChange(event: WechatMiniprogram.PickerChange) { this.setData({ sizeIndex: Number(event.detail.value) }); },
  input() {
    const { competitionId, name, wechat, sizeIndex } = this.data;
    return { competitionId, name, wechat, maxMembers: sizeIndex + MIN_MEMBERS };
  },
  // 点“创建队伍并转发”：先在本地查；订阅消息要在点按里弹，所以放在最前面、不等别的（模板为空时什么都不做）
  submit() {
    const problem = checkCreateInput(this.input());
    if (problem) { wx.showToast({ title: problem, icon: 'none' }); return Promise.resolve(); }
    requestApplyNotice();
    return this.withProfile('createNow');
  },
  async createNow() {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      const team = await createTeam(this.input());
      wx.redirectTo({ url: `/pages/team-detail/team-detail?id=${encodeURIComponent(team.id)}` });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '创建失败', icon: 'none' });
    }
    this.setData({ submitting: false });
  },
});
