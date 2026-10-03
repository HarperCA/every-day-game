import { INFO_PAGES as pages } from '../../services/infoContent';

Page({
  data: {
    page: pages.about,
    pageType: 'about',
    isRecommendationPage: false,
    expandedSections: [] as boolean[],
  },
  onLoad(options: Record<string, string>) {
    const pageType = Object.prototype.hasOwnProperty.call(pages, options.type) ? options.type : 'about';
    const page = pages[pageType];
    const isRecommendationPage = pageType === 'recommendation' || pageType === 'recommendationOther';
    this.setData({ page, pageType, isRecommendationPage, expandedSections: page.sections.map(() => !isRecommendationPage) });
    wx.setNavigationBarTitle({ title: page.title });
  },
  toggleSection(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.isRecommendationPage) return;
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0 || index >= this.data.expandedSections.length) return;
    const expandedSections = [...this.data.expandedSections];
    expandedSections[index] = !expandedSections[index];
    this.setData({ expandedSections });
  },
  openRecommendationOther() {
    wx.navigateTo({ url: '/pages/info/info?type=recommendationOther' });
  },
});
