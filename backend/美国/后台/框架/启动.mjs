// 启动：按 目录清单.mjs 生成左侧目录，按地址（#比赛列表）显示那一页（2026-11-01 用户定）。
// 分类只是标题，不能点；子页面是链接。中间只放当前这一页，不接别的页，换页时回到顶部。
// 页面上有什么、什么顺序，只改 目录清单.mjs；每个功能的内容只改 功能/ 里它自己的文件夹。
import { 目录清单 } from '../目录清单.mjs';
import { 建 } from './dom.mjs';
import { 找页 } from './目录.mjs';
import { 挂载页 } from './页面.mjs';

const 内容 = document.getElementById('内容');
const 目录 = document.getElementById('目录');

const 链接 = new Map();
for (const 分类 of 目录清单) {
  const 组 = 建('div', { class: '分类', role: 'group', 'aria-labelledby': `分类-${分类.id}` },
    建('div', { class: '分类标题', id: `分类-${分类.id}` }, 分类.标题));
  for (const 页 of 分类.页们) {
    const a = 建('a', { href: `#${encodeURIComponent(页.地址)}` }, 页.标题);
    链接.set(页, a);
    组.append(a);
  }
  目录.append(组);
}

function 显示() {
  const 页 = 找页(目录清单, location.hash);
  for (const [p, a] of 链接) {
    a.classList.toggle('当前', p === 页);
    if (p === 页) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  内容.replaceChildren(挂载页(页));
  document.title = `${页.标题} · 竞赛雷达后台`;
  window.scrollTo(0, 0);
  链接.get(页).scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
window.addEventListener('hashchange', 显示);
显示();

// 顶栏右侧：在本机跑时标明是本地预览
if (['localhost', '127.0.0.1'].includes(location.hostname)) document.getElementById('顶栏右侧').append(建('span', {}, '本机预览'));
