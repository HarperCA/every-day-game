// 屏蔽网站 · 呈现（浏览器里跑）：照旧后台的 SiteBlocklistModule.tsx 搬。建议屏蔽、已屏蔽、决定不屏蔽三块；
// 点按钮经 重新读取 把操作交给 数据库.mjs，做完交回新的名单重画。
export function 呈现(容器, 数据, { 重新读取, 建 }) {
  const 做 = (host, decision) => 重新读取({ host, decision });
  const 按钮 = (文字, host, decision) => 建('button', { type: 'button', onclick: () => 做(host, decision) }, 文字);
  const 表 = (列, 行们) => 建('div', { class: '表格外框' }, 建('table', { class: '表格' },
    建('thead', {}, 建('tr', {}, 列.map(名 => 建('th', {}, 名)))), 建('tbody', {}, 行们)));

  容器.append(建('p', { class: '标签说明' }, '每晚百度搜索不返回这些网站（及其子站）的结果，空出的位置留给别的网站。只对百度有效；按次计费，屏蔽不省搜索次数，省的是后面判重、筛选和 AI 追溯的开销。'));
  if (数据.提示) 容器.append(建('div', { class: '状态' }, 数据.提示));

  容器.append(建('h3', {}, `建议屏蔽（${数据.建议们.length}）`), 建('p', { class: '标签说明' }, 数据.统计说明));
  容器.append(数据.建议们.length
    ? 表(['网站', '出现次数', '情况', '例子', '操作'], 数据.建议们.map(x => 建('tr', {},
      建('td', {}, 建('b', {}, x.host), 建('div', { class: '次要' }, x.期间)),
      建('td', {}, 建('b', {}, String(x.次数))),
      建('td', { class: '可换行' }, x.情况),
      建('td', { class: '可换行' }, x.例子.map(s => 建('div', { class: '次要' }, 建('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title || s.url)))),
      建('td', {}, 按钮('确认屏蔽', x.host, 'block'), ' ', 按钮('不屏蔽', x.host, 'dismiss')))))
    : 建('p', { class: '标签说明' }, '没有新的建议。'));

  容器.append(建('h3', {}, `已屏蔽（内置 ${数据.内置几个}，后台确认 ${数据.确认几个}）`), 表(['网站', '来源', '原因', '操作'], 数据.已屏蔽们.map(x => 建('tr', {},
    建('td', {}, 建('b', {}, x.host)),
    建('td', {}, x.来源, x.时间 ? 建('div', { class: '次要' }, x.时间) : null),
    建('td', { class: '可换行' }, x.原因),
    建('td', {}, x.能取消 ? 按钮('取消屏蔽', x.host, 'unblock') : 建('span', { class: '次要' }, '改代码才能去掉'))))));

  if (数据.不屏蔽们.length) {
    容器.append(建('h3', {}, `决定不屏蔽（${数据.不屏蔽们.length}）`), 建('p', { class: '标签说明' }, '之后的统计不再建议这些网站；点“恢复”后，下一次统计还可能再列出。'),
      表(['网站', '决定时间', '操作'], 数据.不屏蔽们.map(x => 建('tr', {},
        建('td', {}, 建('b', {}, x.host), x.当时次数 ? 建('div', { class: '次要' }, `当时出现 ${x.当时次数} 次`) : null),
        建('td', {}, x.时间), 建('td', {}, 按钮('恢复', x.host, 'restore'))))));
  }
}
