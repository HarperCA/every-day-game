// 操作记录 · 呈现（浏览器里跑）：按类型筛、按名称或编号搜、翻页都经 重新读取 交给 数据库.mjs；只看不改。
export function 呈现(容器, 数据, { 重新读取, 建 }) {
  const 读 = 改 => 重新读取({ 页: 数据.页, 类型: 数据.类型, 搜: 数据.搜, ...改 });
  const 搜索 = 建('input', { type: 'search', placeholder: '搜比赛或届次的名称、编号', value: 数据.搜, 'aria-label': '搜索' });
  const 去搜 = () => 读({ 搜: 搜索.value, 页: 1 });
  搜索.addEventListener('keydown', 事件 => { if (事件.key === 'Enter') 去搜(); });
  容器.append(建('div', { class: '工具栏' },
    建('select', { 'aria-label': '按类型筛选', onchange: 事件 => 读({ 类型: 事件.target.value, 页: 1 }) },
      数据.类型们.map(名 => 建('option', { value: 名, selected: 名 === 数据.类型 }, 名))),
    搜索,
    建('button', { type: 'button', onclick: 去搜 }, '搜索'),
    建('span', { class: '次要' }, `共 ${数据.总数} 条`)));

  if (!数据.总数) {
    容器.append(建('div', { class: '状态' }, 数据.搜 || 数据.类型 !== '全部' ? '没有符合条件的记录。' : '还没有操作记录。后台里改比赛、删除恢复、自动维护都会记在这里。'));
    return;
  }
  容器.append(建('div', { class: '表格外框' }, 建('table', { class: '表格' },
    建('thead', {}, 建('tr', {}, ['时间', '做了什么', '对象', '操作人', '详情'].map(名 => 建('th', {}, 名)))),
    建('tbody', {}, 数据.行们.map(r => 建('tr', {},
      建('td', {}, r.时间),
      建('td', {}, r.动作),
      建('td', { class: '可换行' }, r.对象类 ? 建('span', { class: '次要' }, `${r.对象类} `) : null, r.对象,
        r.编号 && r.编号 !== r.对象 ? 建('div', { class: '次要' }, r.编号) : null),
      建('td', {}, r.操作人),
      建('td', { class: '可换行' }, r.详情.map(行 => 建('div', {}, 行)))))))));

  if (数据.共几页 > 1) {
    容器.append(建('div', { class: '工具栏 翻页' },
      建('button', { type: 'button', disabled: !数据.有上一页, onclick: () => 读({ 页: 数据.页 - 1 }) }, '上一页'),
      建('span', {}, `第 ${数据.页} / ${数据.共几页} 页`),
      建('button', { type: 'button', disabled: !数据.有下一页, onclick: () => 读({ 页: 数据.页 + 1 }) }, '下一页')));
  }
}
