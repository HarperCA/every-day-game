import { getCurrentUserId } from '../../services/cloudSession';
import { feedbackTypes, feedbackStatusLabels, feedbackDate, listGeneralFeedback, GeneralFeedbackRecord } from '../../services/generalFeedback';

Page({
  data: { records: [] as Array<GeneralFeedbackRecord & { typeLabel: string; statusLabel: string; createdText: string; updatedText: string }>, loading: false, error: '', page: 0, hasMore: false, total: 0 },
  onShow() { this.loadRecords(true); },
  onUnload() { (this as any).recordsRequestId = ((this as any).recordsRequestId || 0) + 1; },
  async onPullDownRefresh() { try { await this.loadRecords(true); } finally { wx.stopPullDownRefresh(); } },
  onReachBottom() { if (this.data.hasMore) this.loadRecords(false); },
  retry() { this.loadRecords(this.data.page === 0); },
  async loadRecords(reset: boolean) {
    if (this.data.loading && !reset) return;
    const requestId = ((this as any).recordsRequestId || 0) + 1;
    (this as any).recordsRequestId = requestId;
    const startingOwner = getCurrentUserId();
    if ((this as any).recordsOwner !== startingOwner) this.setData({ records: [], page: 0, total: 0, hasMore: false });
    this.setData({ loading: true, error: '' });
    try {
      if (!await getApp<any>().requestWechatLogin()) { this.setData({ error: '登录后可查看你的反馈记录' }); return; }
      if ((this as any).recordsRequestId !== requestId) return;
      const owner = getCurrentUserId();
      if ((this as any).recordsOwner !== owner) {
        (this as any).recordsOwner = owner;
        this.setData({ records: [], page: 0, total: 0, hasMore: false });
        reset = true;
      }
      const page = reset ? 1 : this.data.page + 1;
      const result = await listGeneralFeedback(page);
      if ((this as any).recordsRequestId !== requestId || getCurrentUserId() !== owner) return;
      const items = (result.items || []).map(item => ({ ...item, typeLabel: feedbackTypes.find(type => type.value === item.type)?.label || '其他', statusLabel: feedbackStatusLabels[item.status] || '待处理', createdText: feedbackDate(item.createdAt), updatedText: feedbackDate(item.updatedAt) }));
      const records = reset ? items : this.data.records.concat(items);
      this.setData({ records: records.filter((item, index) => records.findIndex(record => record.id === item.id) === index), page, hasMore: result.hasMore, total: result.total });
    } catch (error) { if ((this as any).recordsRequestId !== requestId) return; this.setData({ error: error instanceof Error ? error.message : '加载失败，请重试' }); }
    finally { if ((this as any).recordsRequestId === requestId) this.setData({ loading: false }); }
  },
});
