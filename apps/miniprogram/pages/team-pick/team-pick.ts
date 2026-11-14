// 选择比赛（2026-11-05）：创建队伍时用。比赛近 800 场，放不进下拉框，所以搜索选择；选好交回创建页。
import { listHomeCompetitions } from '../../services/repository';

const PAGE_SIZE = 20;
let latestRequest = 0;

Page({
  data: { keyword: '', items: [] as any[], loading: true, error: '' },
  onLoad() { return this.search(); },
  onKeyword(event: WechatMiniprogram.Input) { this.setData({ keyword: event.detail.value }); },
  async search() {
    const request = ++latestRequest;
    this.setData({ loading: true, error: '' });
    try {
      const result = await listHomeCompetitions({ keyword: this.data.keyword.trim(), pageSize: PAGE_SIZE });
      if (request === latestRequest) this.setData({ items: result.items, loading: false });
    } catch (error) {
      if (request === latestRequest) this.setData({ items: [], loading: false, error: error instanceof Error ? error.message : '加载失败' });
    }
  },
  choose(event: WechatMiniprogram.TouchEvent) {
    const item = this.data.items.find((one: any) => one.id === event.currentTarget.dataset.id);
    if (!item) return;
    const pages = getCurrentPages();
    pages[pages.length - 2]?.onCompetitionPicked?.(item);
    wx.navigateBack();
  },
});
