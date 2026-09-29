// 说明页：推荐等级说明、关于沿用小程序的文案；隐私说明按网页测试版的实际做法单独写。
import { INFO_PAGES, type InfoContent } from '../../../miniprogram/services/infoContent';
import { track } from '../track';
import { app, esc, setPageHandlers } from '../ui';

const WEB_PRIVACY: InfoContent = {
  title: '隐私说明',
  subtitle: '网页测试版用于了解大家是否需要这个产品，只处理改进产品所必需的匿名数据。',
  notice: '网页测试版不需要登录，不采集任何能识别你身份的信息。',
  sections: [
    { title: '匿名记录的内容', items: ['打开了哪些页面、搜索了哪些关键词、使用了哪些筛选条件', '查看了哪些赛事、是否点击了官方报名页或复制了报名链接', '收藏或取消收藏的赛事', '你主动提交的信息纠错内容', '使用的是手机还是电脑'] },
    { title: '如何做到匿名', paragraphs: ['浏览器第一次打开时会在本地生成一个随机编号，用来区分“同一个人来了几次”，不与你的微信、手机号或任何账号关联。服务器不记录 IP 地址和浏览器详细信息。'] },
    { title: '不采集的数据', items: ['手机号、真实姓名、学校和学号', '成绩、获奖记录和综测信息', '通讯录和位置信息'] },
    { title: '保存在你浏览器里的数据', paragraphs: ['收藏和你提交过的纠错记录只保存在当前浏览器；清除浏览器数据后会丢失，也不会同步到其他设备。'] },
    { title: '安全提示', paragraphs: ['官方报名在赛事主办方页面完成。请不要在信息纠错中填写身份证号、银行卡号、密码等敏感信息。'] },
  ],
};

export function renderInfo(type: string) {
  setPageHandlers({});
  const page = type === 'privacy' ? WEB_PRIVACY : INFO_PAGES[type] || INFO_PAGES.about;
  document.title = `${page.title} · 竞赛雷达`;
  track('view_page', { page: `info-${type}` });
  window.scrollTo(0, 0);
  app().innerHTML = `<div class="page pg-info info-page">
    <div class="hero card"><div class="eyebrow">使用说明</div><div class="title">${esc(page.title)}</div><div class="subtitle">${esc(page.subtitle)}</div></div>
    ${page.notice ? `<div class="notice"><div class="notice-mark">!</div><span>${esc(page.notice)}</span></div>` : ''}
    ${page.sections.map(section => `<div class="section card ${section.level ? `level-${section.level}` : ''}">
      <div class="section-title">${section.level ? '<div class="level-dot"></div>' : ''}<span>${esc(section.title)}</span></div>
      ${(section.paragraphs || []).map(p => `<div class="paragraph">${esc(p)}</div>`).join('')}
      ${(section.items || []).map(point => `<div class="bullet"><div class="bullet-dot"></div><span>${esc(point)}</span></div>`).join('')}
    </div>`).join('')}
    <div class="footer-note">请以赛事官方最新通知为准</div>
  </div>`;
}
