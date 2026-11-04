// 访问异常 · 呈现（浏览器里跑）：照旧后台 ClientIssuesModule.tsx 搬（2026-11-02）。时间范围选择、成功率和各类次数、每天、按网络和操作、最近 100 条。
// 加载统计现在由北京记，列名“上海成功”改叫“加载成功”；“退回美国”是旧小程序才有的情况。
const 百分比 = 值 => 值 == null ? '—' : `${(值 * 100).toFixed(值 >= 0.995 && 值 < 1 ? 1 : 0)}%`;
const 时间 = 值 => 值 ? new Date(值).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '';
const 网络 = { wifi: 'Wi-Fi', '4g': '4G', '5g': '5G', '3g': '3G', '2g': '2G', none: '无网络', unknown: '未知' };

export function 呈现(容器, 数据, { 条件, 改条件, 重新读取, 建, 占位 }) {
  if (!数据.接好了) {
    占位({ 来源: 数据.来源, 要做: ['美国还没配用户副本（DB_DIR/用户副本.db），或北京还没开始同步'] });
    return;
  }
  const 表 = (列, 行们) => 建('div', { class: '表格外框' }, 建('table', { class: '表格' },
    建('thead', {}, 建('tr', {}, 列.map(名 => 建('th', {}, 名)))), 建('tbody', {}, 行们)));
  const 排行 = 计数 => {
    const 行们 = Object.entries(计数).sort((a, b) => b[1] - a[1]);
    return 行们.length ? 建('ul', { class: '排行' }, 行们.map(([键, 数]) => 建('li', {}, 建('span', {}, 网络[键] || 键), ' ', 建('b', {}, String(数))))) : 建('p', { class: '次要' }, '没有异常');
  };
  const 坏 = 是 => (是 ? '坏' : null);

  容器.append(建('p', { class: '标签说明' }, '小程序在用户手机上出的问题：加载失败、加载慢、登录收藏提醒失败、程序报错。匿名记录，不含身份信息；手机断网时先存着，下次打开再补发，所以数字可能晚到几分钟到几天。数据每 10 分钟从北京同步一次。'));
  容器.append(建('div', { class: '工具条' },
    建('select', { 'aria-label': '时间范围', onchange: e => 改条件({ 天数: Number(e.target.value) }) },
      [[1, '今天'], [7, '最近 7 天'], [14, '最近 14 天'], [30, '最近 30 天']].map(([值, 名]) => 建('option', { value: 值, selected: (条件.天数 || 14) === 值 }, 名))),
    建('button', { type: 'button', onclick: () => 重新读取() }, '刷新')));

  容器.append(建('div', { class: '数字卡片们' },
    建('div', { class: '数字卡片' }, 建('span', {}, '加载成功率'), 建('b', { class: 坏(数据.summary.successRate != null && 数据.summary.successRate < 0.98) }, 百分比(数据.summary.successRate)), 建('small', {}, `${数据.summary.attempts} 次加载`)),
    Object.entries(数据.kindLabels).map(([种类, 名]) => 建('div', { class: '数字卡片' }, 建('span', {}, 名), 建('b', { class: 坏(种类 === 'load_failed' && 数据.byKind[种类]) }, String(数据.byKind[种类] || 0)), 建('small', {}, '次')))));

  容器.append(建('h3', {}, '每天'), 表(['日期', '加载成功率', '加载成功', '退回美国（旧版）', '加载失败', '加载慢', '登录/收藏/提醒失败', '代码报错'],
    数据.daily.map(天 => 建('tr', {}, 建('td', {}, 天.date), 建('td', { class: 坏(天.successRate != null && 天.successRate < 0.98) }, 百分比(天.successRate)),
      建('td', {}, String(天.shanghaiOk)), 建('td', {}, String(天.fallback)), 建('td', { class: 坏(天.failed) }, String(天.failed)),
      建('td', {}, String(天.slow)), 建('td', {}, String(天.userDataFailed)), 建('td', {}, String(天.jsError))))));

  容器.append(建('div', { class: '两栏' }, 建('div', {}, 建('h3', {}, '按网络'), 排行(数据.byNetwork)), 建('div', {}, 建('h3', {}, '按操作'), 排行(数据.byAction))));

  容器.append(建('h3', {}, '最近的异常（最多 100 条）'), 数据.recent.length
    ? 表(['时间', '类型', '页面 / 操作', '错误信息', '耗时', '网络', '设备'], 数据.recent.map(条 => 建('tr', {},
      建('td', {}, 时间(条.at)),
      建('td', { class: 坏(条.kind === 'load_failed') }, 数据.kindLabels[条.kind] || 条.kind),
      建('td', { class: '可换行' }, 条.page || '', 条.action ? 建('div', { class: '次要' }, 条.action) : null),
      建('td', { class: '可换行' }, 条.message || '', 条.extra ? 建('div', { class: '次要' }, 条.extra) : null),
      建('td', {}, 条.elapsed_ms != null ? `${(条.elapsed_ms / 1000).toFixed(1)} 秒` : ''),
      建('td', {}, 网络[条.networkType] || 条.networkType || ''),
      建('td', {}, 建('div', { class: '次要' }, `${条.platform || ''} ${条.system || ''}`), 建('div', { class: '次要' }, `微信 ${条.wechatVersion || ''} · 小程序 ${条.appVersion || 条.envVersion || ''}`)))))
    : 建('p', { class: '标签说明' }, '这段时间没有异常记录。'));
}
