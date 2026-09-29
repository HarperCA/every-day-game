// 网页测试版入口：按地址栏 # 后面的路径切换页面（和小程序的页面一一对应）。
//   #/              找比赛（pages/index）
//   #/detail/<id>   赛事详情（pages/detail）
//   #/favorites     我的收藏（pages/favorites）
//   #/feedback/<id> 信息纠错（pages/feedback）
//   #/my            我的（pages/my）
//   #/info/<类型>   说明页（pages/info）
import './mp.css';
import './web.css';
import { renderDetail } from './pages/detail';
import { renderFavorites } from './pages/favorites';
import { renderFeedback } from './pages/feedback';
import { renderIndex } from './pages/index';
import { renderInfo } from './pages/info';
import { renderMy } from './pages/my';
import { track } from './track';
import { enterView, installRootHandlers } from './ui';

const TABS = [{ hash: '#/', label: '找比赛', icon: '⌕' }, { hash: '#/my', label: '我的', icon: '☺' }];

function route() {
  const [, page = '', ...rest] = (location.hash || '#/').slice(1).split('/');
  const arg = decodeURIComponent(rest.join('/'));
  const name = page || 'index';
  const seq = enterView(name);
  if (name === 'detail') void renderDetail(arg, seq);
  else if (name === 'favorites') void renderFavorites(seq);
  else if (name === 'feedback') void renderFeedback(arg);
  else if (name === 'my') renderMy();
  else if (name === 'info') renderInfo(arg);
  else { enterView('index'); renderIndex(); }
  // 底部标签栏只在两个主页面显示，和小程序一样
  const tab = name === 'my' ? '#/my' : name === 'index' || !['detail', 'favorites', 'feedback', 'info'].includes(name) ? '#/' : '';
  const bar = document.getElementById('tabbar')!;
  bar.hidden = !tab;
  bar.innerHTML = TABS.map(t => `<a href="${t.hash}" class="${t.hash === tab ? 'active' : ''}"><span class="tab-icon">${t.icon}</span>${t.label}</a>`).join('');
  document.getElementById('back')!.hidden = Boolean(tab);
}

installRootHandlers();
document.getElementById('back')!.addEventListener('click', () => (history.length > 1 ? history.back() : (location.hash = '#/')));
addEventListener('hashchange', route);
track('visit', {});
route();
