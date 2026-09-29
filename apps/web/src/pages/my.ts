// “我的”：小程序里有微信登录和提醒，网页测试版都没有，只保留收藏、纠错和说明页入口。
import { getFavoriteRecords, getFeedbackRecords } from '../favorites';
import { track } from '../track';
import { app, go, setPageHandlers } from '../ui';

const handlers = {
  act: {
    favorites: () => go('#/favorites'),
    feedback: () => go('#/feedback'),
    info: (el: HTMLElement) => go(`#/info/${el.dataset.type}`),
  },
};

export function renderMy() {
  setPageHandlers(handlers);
  document.title = '我的 · 竞赛雷达';
  track('view_page', { page: 'my' });
  app().innerHTML = `<div class="page pg-my">
    <div class="profile card"><div class="avatar">测</div><div><div class="name">网页测试版</div><div class="muted">无需登录 · 收藏只保存在当前浏览器</div></div></div>
    <div class="menu card"><div data-act="favorites">我的收藏<span>${getFavoriteRecords().length} 场 ›</span></div><div data-act="feedback">信息纠错<span>${getFeedbackRecords().length} 条 ›</span></div></div>
    <div class="menu card"><div data-act="info" data-type="recommendation">推荐等级说明<span>›</span></div><div data-act="info" data-type="privacy">隐私说明<span>›</span></div><div data-act="info" data-type="about">关于<span>›</span></div></div>
    <div class="privacy">网页测试版不需要登录，不采集手机号、姓名、学校、学号等个人信息。为改进产品，会匿名记录浏览、搜索和点击情况，详见“隐私说明”。截止提醒请使用微信小程序正式版。</div>
  </div>`;
}
