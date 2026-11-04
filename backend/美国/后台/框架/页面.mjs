// 页面：一个子页面的外框（“分类 · 页名”、标题、说明），顶部功能（比赛列表页上的比赛数据总览）在上，这一页的功能在下。
// 每次打开这一页都重新运行功能，拿到的是最新数据。
//   挂载页(页) → 元素
import { 建 } from './dom.mjs';
import { 运行功能 } from './功能.mjs';

export function 挂载页(页) {
  const 根 = 建('section', { class: '页', 'aria-labelledby': '页标题' },
    建('div', { class: '页头' },
      建('div', { class: '页路径' }, 页.分类.标题),
      建('h1', { id: '页标题' }, 页.标题),
      页.说明 ? 建('p', {}, 页.说明) : null));
  for (const 功能 of 页.顶部) {
    const 内容区 = 建('div');
    根.append(建('div', { class: '页顶部' }, 建('h2', {}, 功能.标题), 功能.说明 ? 建('p', { class: '标签说明' }, 功能.说明) : null, 内容区));
    运行功能(功能, 内容区);
  }
  const 身 = 建('div', { class: '页身' });
  根.append(身);
  运行功能(页.功能, 身);
  return 根;
}
