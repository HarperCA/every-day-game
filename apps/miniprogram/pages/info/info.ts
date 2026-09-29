import { INFO_PAGES as pages } from '../../services/infoContent';

Page({
  data: {
    page: pages.about,
  },
  onLoad(options: Record<string, string>) {
    const page = pages[options.type] || pages.about;
    this.setData({ page });
    wx.setNavigationBarTitle({ title: page.title });
  },
});
