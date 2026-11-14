const 值 = n => n ?? '—';
const 页面名 = { 'pages/index/index': '找比赛', 'pages/detail/detail': '比赛详情', 'pages/my/my': '我的',
  'pages/school/school': '校赛', 'pages/team/team': '组队' };

export function 画小程序统计(容器, { 发请求, 建 }) {
  const 日期 = 建('input', { type: 'date', 'aria-label': '统计截止日期' });
  const 范围 = 建('select', { 'aria-label': '统计天数' },
    建('option', { value: 7 }, '最近 7 天'), 建('option', { value: 30 }, '最近 30 天'));
  const 内容 = 建('div', { 'aria-live': 'polite' });
  const 按钮 = 建('button', { type: 'button', class: '切换', onclick: 加载 }, '查询');
  const 面板 = 建('details', {}, 建('summary', {}, '小程序访问统计'),
    建('div', { class: '工具栏' }, 日期, 范围, 按钮), 内容);
  面板.addEventListener('toggle', () => { if (面板.open && !已加载) 加载(); });
  容器.append(面板);
  let 已加载 = false;

  function 表(列, 行, 空说明 = '微信暂未返回数据') {
    return 行.length
      ? 建('table', { class: '表格' }, 建('thead', {}, 建('tr', {}, 列.map(s => 建('th', { scope: 'col' }, s)))),
        建('tbody', {}, 行.map(row => 建('tr', {}, row.map(cell => 建('td', {}, 值(cell)))))))
      : 建('p', { class: '标签说明' }, 空说明);
  }

  function 留存率(返回, 人数) {
    if (返回 == null || !人数) return '—';
    return new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 }).format(返回 / 人数);
  }

  async function 加载() {
    if (按钮.disabled) return;
    按钮.disabled = true;
    内容.replaceChildren(建('p', {}, '正在读取微信统计…'));
    try {
      const r = await 发请求({ 动作: '小程序统计', 日期: 日期.value, 天数: Number(范围.value) });
      if (!面板.isConnected) return;
      日期.value = r.日期;
      日期.max = r.最晚日期;
      已加载 = true;
      const 显示 = r.趋势[0];
      const 留存 = r.留存;
      内容.replaceChildren(
        建('p', {}, r.日期 + ' · 访客 ' + 值(显示?.访客) + ' · 新访客 ' + 值(显示?.新访客) + ' · 打开 ' + 值(显示?.打开次数) + ' 次'),
        建('h3', {}, '每日访问'),
        表(['日期', '访客', '新访客', '打开次数', '页面访问次数'], r.趋势.map(x => [
          x.错误 ? x.日期 + '（' + x.错误 + '）' : x.日期, x.访客, x.新访客, x.打开次数, x.页面访问次数,
        ])),
        建('h3', {}, '访问来源 · ' + r.日期),
        表(['来源', '访客', '打开次数'], r.来源.map(x => [x.名称, x.访客, x.打开次数]), r.错误.来源),
        建('h3', {}, '页面访问 · ' + r.日期),
        表(['页面', '访客', '访问次数', '进入次数', '退出次数'], r.页面.map(x => [
          页面名[x.路径] || x.路径, x.访客, x.访问次数, x.入口次数, x.退出次数,
        ]), r.错误.页面),
        建('h3', {}, '次日留存 · ' + 留存.日期),
        r.错误.留存 ? 建('p', {}, r.错误.留存) : 表(['访客类别', '当日访客', '次日回访', '留存率'], [
          ['新访客', 留存.新访客, 留存.新访客次日, 留存率(留存.新访客次日, 留存.新访客)],
          ['全部访客', 留存.访客, 留存.访客次日, 留存率(留存.访客次日, 留存.访客)],
        ]),
      );
    } catch {
      内容.replaceChildren(建('p', {}, '小程序统计暂时无法读取，请重新查询。'));
    } finally {
      按钮.disabled = false;
    }
  }
}
