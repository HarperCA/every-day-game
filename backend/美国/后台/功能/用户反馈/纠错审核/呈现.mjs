// 纠错审核 · 呈现（浏览器里跑）：列出用户报的错误，连着比赛库里那一届的名称和现在的状态（2026-11-02）。
// 每条“审核”打开对话框：写说明，点采纳或驳回，经 提交 写回北京；采纳的那一届会转回待人工审核，去比赛列表改。失败时对话框不关。
const 时间 = 值 => 值 ? new Date(值).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '—';

function 打开审核框(条, { 提交, 建 }) {
  const 说明 = 建('textarea', { name: '说明', maxlength: 2000, placeholder: '采纳：核过哪里、要改什么（选填）；驳回：必须写原因。' });
  const 出错 = 建('div', { class: '状态 出错', hidden: true });
  const 框 = 建('dialog', { class: '编辑框' });
  const 按钮们 = [];
  const 做 = async 动作 => {
    按钮们.forEach(b => { b.disabled = true; }); 出错.hidden = true;
    try {
      await 提交({ 动作, 编号: 条.id, 说明: 说明.value, 读到的更新时间: 条.updated_at });
      框.close(); 框.remove();
    } catch (错误) {
      出错.textContent = String(错误?.message || 错误); 出错.hidden = false; 按钮们.forEach(b => { b.disabled = false; });
    }
  };
  按钮们.push(建('button', { type: 'button', class: '危险', onclick: () => 做('驳回') }, '驳回'), 建('button', { type: 'button', class: '主要', onclick: () => 做('采纳') }, '采纳'));
  框.append(建('form', { method: 'dialog', onsubmit: e => e.preventDefault() },
    建('h3', {}, '审核纠错'),
    建('p', { class: '次要' }, `${条.类别} · ${时间(条.created_at)} · 账号 ${条.账号}`),
    建('p', {}, 建('b', {}, 条.competition_name), 条.届次 ? `（${条.届次.名称}，现在${条.届次.状态}）` : '（届次已不在比赛库）'),
    建('p', { class: '可换行' }, 条.content),
    条.evidence_url ? 建('p', {}, '依据：', 建('a', { href: 条.evidence_url, target: '_blank', rel: 'noopener noreferrer' }, 条.evidence_url)) : null,
    建('label', {}, '说明', 说明),
    出错,
    建('div', { class: '按钮行' }, 建('button', { type: 'button', onclick: () => { 框.close(); 框.remove(); } }, '取消'), ...按钮们)));
  document.body.append(框);
  框.showModal();
}

export function 呈现(容器, 数据, 控制) {
  const { 改条件, 重新读取, 建, 占位 } = 控制;
  if (!数据.接好了) {
    占位({ 来源: 数据.来源, 要做: ['美国还没配用户副本（DB_DIR/用户副本.db），或北京还没开始同步'] });
    return;
  }
  容器.append(建('p', { class: '标签说明' }, '用户报的比赛信息错误。采纳后那一届转回待人工审核，去比赛列表改好再发布；驳回要写原因。处理结果写回北京，用户在“我的纠错”里看得到。列表每 10 分钟从北京同步一次。'));
  if (数据.结果) 容器.append(建('div', { class: '状态' }, 数据.结果));
  容器.append(建('div', { class: '工具条' },
    建('select', { 'aria-label': '视图', onchange: e => 改条件({ 视图: e.target.value }) }, 数据.视图们.map(名 => 建('option', { value: 名, selected: 数据.视图 === 名 }, `${名} ${数据.数量[名]}`))),
    建('button', { type: 'button', onclick: () => 重新读取() }, '刷新')));
  if (!数据.条目们.length) { 容器.append(建('p', { class: '标签说明' }, '暂无符合条件的纠错。')); return; }
  容器.append(建('div', { class: '表格外框' }, 建('table', { class: '表格' },
    建('thead', {}, 建('tr', {}, ['比赛 / 届次', '哪方面', '内容', '提交时间', '状态', '操作'].map(名 => 建('th', {}, 名)))),
    建('tbody', {}, 数据.条目们.map(条 => 建('tr', {},
      建('td', { class: '可换行' }, 建('b', {}, 条.competition_name), 建('div', { class: '次要' }, 条.届次 ? `${条.届次.名称} · ${条.届次.状态}` : '届次已不在比赛库')),
      建('td', {}, 条.类别),
      建('td', { class: '可换行' }, 条.content, 条.evidence_url ? 建('div', { class: '次要' }, 建('a', { href: 条.evidence_url, target: '_blank', rel: 'noopener noreferrer' }, '依据')) : null),
      建('td', {}, 时间(条.created_at), 建('div', { class: '次要' }, `账号 ${条.账号}`)),
      建('td', {}, 条.状态),
      建('td', {}, 条.能处理 ? 建('button', { type: 'button', onclick: () => 打开审核框(条, 控制) }, '审核') : 建('span', { class: '次要' }, '已处理'))))))));
}
