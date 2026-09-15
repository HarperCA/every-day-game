import { callUserData } from '../../services/cloudSession';
import { listCompetitions } from '../../services/repository';

const categories = [
  { value: 'time', label: '时间信息' },
  { value: 'registration_link', label: '报名链接' },
  { value: 'eligibility', label: '参赛资格' },
  { value: 'rules', label: '比赛规则' },
  { value: 'other', label: '其他问题' },
];

// 与 adminData 的 FEEDBACK_STATUSES 对应，转成用户看得懂的说法。
const statusLabels: Record<string, string> = {
  pending_ai_review: '待审核',
  ai_queued: '审核中',
  ai_passed: '审核中',
  ai_flagged: '审核中',
  human_reviewing: '管理员复核中',
  accepted: '已采纳',
  rejected: '未采纳',
};

function decodeQueryValue(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  try { return decodeURIComponent(value) || fallback; }
  catch (_error) { return value; }
}

function formatDate(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

Page({
  data: {
    editionId: '',
    competitionName: '',
    lockedCompetition: false,
    competitions: [] as Array<{ id: string; label: string }>,
    competitionIndex: -1,
    competitionsLoading: false,
    categories,
    categoryIndex: 0,
    content: '',
    evidenceUrl: '',
    submitting: false,
    records: [] as Array<Record<string, string>>,
    recordsLoading: false,
    recordsHint: '',
  },
  onLoad(options: Record<string, string>) {
    const editionId = decodeQueryValue(options.id, '');
    if (editionId) {
      // 从赛事详情页进入：赛事已确定，不再让用户选。
      this.setData({
        editionId,
        competitionName: decodeQueryValue(options.name, '当前赛事'),
        lockedCompetition: true,
      });
    } else {
      this.loadCompetitions();
    }
  },
  onShow() {
    this.loadRecords();
  },
  async loadCompetitions() {
    this.setData({ competitionsLoading: true });
    try {
      const result = await listCompetitions({ page: 1, pageSize: 200 } as any);
      const competitions = (result.items || []).map((item: any) => ({
        id: item.id,
        label: item.editionName ? `${item.name}（${item.editionName}）` : item.name,
      }));
      this.setData({ competitions });
    } catch (_error) {
      wx.showToast({ title: '赛事列表加载失败', icon: 'none' });
    } finally {
      this.setData({ competitionsLoading: false });
    }
  },
  async loadRecords() {
    this.setData({ recordsLoading: true });
    try {
      const list = await callUserData<any[]>('listFeedback');
      this.setData({
        records: (list || []).map(item => ({
          id: item.id,
          competitionName: item.competitionName || '未记录赛事',
          categoryLabel: (categories.find(entry => entry.value === item.category) || { label: '其他问题' }).label,
          content: item.content,
          statusLabel: statusLabels[item.status] || '处理中',
          statusValue: item.status,
          createdAt: formatDate(item.createdAt),
        })),
        recordsHint: '',
      });
    } catch (_error) {
      // 未登录时无法查询，这不是错误，提示即可。
      this.setData({ records: [], recordsHint: '登录后可查看你提交过的纠错和处理进度。' });
    } finally {
      this.setData({ recordsLoading: false });
    }
  },
  onCompetitionChange(event: WechatMiniprogram.PickerChange) {
    const index = Number(event.detail.value);
    const picked = this.data.competitions[index];
    if (!picked) return;
    this.setData({ competitionIndex: index, editionId: picked.id, competitionName: picked.label });
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
    if (!this.data.editionId) { wx.showToast({ title: '请先选择要纠错的赛事', icon: 'none' }); return; }
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
      // 提交后留在本页刷新进度，让用户直接看到这条记录进入待审核。
      this.setData({ content: '', evidenceUrl: '' });
      await this.loadRecords();
      wx.showModal({
        title: '纠错已提交',
        content: '管理员会核对你提供的说明和证据。审核完成前，赛事页面不会自动改动。你可以在下方查看处理进度。',
        showCancel: false,
      });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '提交失败，请稍后重试', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
