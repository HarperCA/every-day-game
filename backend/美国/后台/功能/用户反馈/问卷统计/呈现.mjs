// 问卷统计 · 呈现（浏览器里跑）：照旧后台 PreferenceStatsModule.tsx 搬（2026-11-02）。总体、专业、关心的比赛大类、省份四块，只有计数。
const 百分比 = (数, 总) => (总 ? `${Math.round(数 / 总 * 100)}%` : '—');
const 时间 = 值 => 值 ? new Date(值).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '未记录';

export function 呈现(容器, 数据, { 重新读取, 建, 占位 }) {
  if (!数据.接好了) {
    占位({ 来源: 数据.来源, 要做: ['美国还没配用户副本（DB_DIR/用户副本.db），或北京还没开始同步'] });
    return;
  }
  const 统计 = 数据.统计;
  const 排行 = (标题, 计数, 基数, 另外) => {
    const 行们 = Object.entries(计数).sort((a, b) => b[1] - a[1]);
    if (另外?.[1]) 行们.push(另外);
    return [建('h3', {}, 标题), 行们.length
      ? 建('div', { class: '表格外框' }, 建('table', { class: '表格' },
        建('thead', {}, 建('tr', {}, ['选项', '人数', '占填完人数'].map(名 => 建('th', {}, 名)))),
        建('tbody', {}, 行们.map(([键, 数]) => 建('tr', {}, 建('td', {}, 键), 建('td', {}, String(数)), 建('td', {}, 百分比(数, 基数)))))))
      : 建('p', { class: '标签说明' }, '还没有数据。')];
  };
  容器.append(建('p', { class: '标签说明' }, '首次打开小程序的偏好问卷（专业、关心的比赛大类、省份）。只统计已登录用户存进账号的答案，没登录的只存在手机本地，不计入。数据每 10 分钟从北京同步一次。'));
  容器.append(建('div', { class: '工具条' }, 建('button', { type: 'button', onclick: () => 重新读取() }, '刷新')));
  容器.append(建('h3', {}, '总体'),
    建('p', {}, '账号数 ', 建('b', {}, String(统计.total)), '：填完 ', 建('b', {}, String(统计.completed)), `（${百分比(统计.completed, 统计.total)}），跳过 `, 建('b', {}, String(统计.skipped)), `（${百分比(统计.skipped, 统计.total)}）。`),
    建('p', { class: '次要' }, `统计时间：${时间(数据.现在)}`));
  容器.append(...排行('专业', 统计.profession, 统计.completed, ['没选专业', 统计.noProfession]));
  容器.append(...排行('关心的比赛大类（多选，一人可算多次）', 统计.categories, 统计.completed, ['不限', 统计.noCategory]));
  容器.append(...排行('省份', 统计.province, 统计.completed, ['不限', 统计.noProvince]));
}
