// 自定义标题栏：品牌图标 + “竞赛雷达”。微信原生标题栏只能放文字，要放图标只能自己画。
// 高度按右上角胶囊按钮算，保证不同机型上文字和胶囊在同一条水平线上。
// inline=true：不固定、不留占位，由页面把它和搜索栏一起包进吸顶区域（首页用，2026-10 改版）。
Component({
  properties: { inline: { type: Boolean, value: false } },
  data: { statusBarHeight: 20, navBarHeight: 44 },
  lifetimes: {
    attached(this: any) {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const statusBarHeight = info.statusBarHeight || 20;
      let navBarHeight = 44;
      try {
        const menu = wx.getMenuButtonBoundingClientRect();
        if (menu && menu.height) navBarHeight = (menu.top - statusBarHeight) * 2 + menu.height;
      } catch (error) {
        // 取不到胶囊位置（极少数环境）时用常见的 44px
      }
      this.setData({ statusBarHeight, navBarHeight });
    },
  },
});
