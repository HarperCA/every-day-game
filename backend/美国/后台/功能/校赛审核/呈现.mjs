// 校赛审核 · 呈现（浏览器里跑，2026-11-08 粗版本）：上面管理员申请、下面校赛，各一张表，待审核在前。
// 每行按状态给按钮（申请：通过、拒绝；校赛：通过、拒绝，已发布的能下架），点了打开对话框：写说明（拒绝、下架必填），确认后经 提交 写回北京。
// 失败时对话框不关，填的说明还在。
const 时间 = 值 => 值 ? new Date(值).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '—';
const 结果名 = { 申请: { 通过: '已通过', 拒绝: '已拒绝' }, 校赛: { 通过: '已发布', 拒绝: '已拒绝', 下架: '已下架' } };

function 打开审核框({ 类, 条, 决定, 摘要 }, { 提交, 建 }) {
  const 要说明 = 决定 !== '通过';
  const 说明 = 建('textarea', { name: '说明', maxlength: 2000, placeholder: 要说明 ? `${决定}的原因（必填，负责人看得到）` : '备注（选填，负责人看得到）' });
  const 出错 = 建('div', { class: '状态 出错', hidden: true });
  const 框 = 建('dialog', { class: '编辑框' });
  const 确认 = 建('button', { type: 'submit', class: 要说明 ? '危险' : '主要' }, `确认${决定}`);
  框.append(建('form', { method: 'dialog', onsubmit: async e => {
    e.preventDefault();
    if (要说明 && !说明.value.trim()) { 出错.textContent = `${决定}要写明原因`; 出错.hidden = false; return; }
    确认.disabled = true; 出错.hidden = true;
    try {
      await 提交({ 动作: 类 === '申请' ? '审核申请' : '审核校赛', 编号: 条.id, 决定, 说明: 说明.value, 读到的更新时间: 条.updated_at });
      框.close(); 框.remove();
    } catch (错误) {
      出错.textContent = String(错误?.message || 错误); 出错.hidden = false; 确认.disabled = false;
    }
  } },
  建('h3', {}, `${决定}${类 === '申请' ? '管理员申请' : '校赛'}（改成“${结果名[类][决定]}”）`),
  ...摘要.map(行 => 建('p', { class: '可换行' }, 行)),
  建('label', {}, '说明', 说明),
  出错,
  建('div', { class: '按钮行' }, 建('button', { type: 'button', onclick: () => { 框.close(); 框.remove(); } }, '取消'), 确认)));
  document.body.append(框);
  框.showModal();
}

const 按钮们 = (类, 条, 摘要, 控制) => 条.能做.length
  ? 条.能做.map(决定 => 控制.建('button', { type: 'button', class: 决定 === '通过' ? '主要' : '危险', onclick: () => 打开审核框({ 类, 条, 决定, 摘要 }, 控制) }, 决定))
  : [控制.建('span', { class: '次要' }, '已处理')];

const 状态格 = (建, 条) => 建('td', { class: '可换行' }, 建('b', {}, 条.status), 条.review_note ? 建('div', { class: '次要' }, `说明：${条.review_note}`) : null);

function 画申请们(容器, 数据, 控制) {
  const { 建 } = 控制;
  容器.append(建('h3', {}, `管理员申请（待审核 ${数据.数量.申请.待审核} / 共 ${数据.数量.申请.全部}）`));
  if (!数据.申请们.length) { 容器.append(建('p', { class: '标签说明' }, '暂无符合条件的管理员申请。')); return; }
  容器.append(建('div', { class: '表格外框' }, 建('table', { class: '表格' },
    建('thead', {}, 建('tr', {}, ['学校', '姓名 / 联系方式', '证明说明', '申请时间', '状态', '操作'].map(名 => 建('th', {}, 名)))),
    建('tbody', {}, 数据.申请们.map(条 => {
      const 摘要 = [`${条.school} · ${条.real_name}（${条.contact || '没留联系方式'}）`, `证明：${条.proof || '未填写'}`, `申请时间：${时间(条.created_at)} · 账号 ${条.账号}`];
      return 建('tr', {},
        建('td', {}, 条.school),
        建('td', {}, 条.real_name, 建('div', { class: '次要' }, 条.contact || '没留联系方式')),
        建('td', { class: '可换行' }, 条.proof || '未填写'),
        建('td', {}, 时间(条.created_at), 建('div', { class: '次要' }, `账号 ${条.账号}`)),
        状态格(建, 条),
        建('td', {}, 按钮们('申请', 条, 摘要, 控制)));
    })))));
}

function 画校赛们(容器, 数据, 控制) {
  const { 建 } = 控制;
  容器.append(建('h3', {}, `校赛（待审核 ${数据.数量.校赛.待审核} / 共 ${数据.数量.校赛.全部}）`));
  if (!数据.校赛们.length) { 容器.append(建('p', { class: '标签说明' }, '暂无符合条件的校赛。')); return; }
  容器.append(建('div', { class: '表格外框' }, 建('table', { class: '表格' },
    建('thead', {}, 建('tr', {}, ['学校', '标题 / 简介', '报名方式', '起止日期', '状态', '操作'].map(名 => 建('th', {}, 名)))),
    建('tbody', {}, 数据.校赛们.map(条 => {
      const 起止 = `${条.start_date || '—'} 至 ${条.end_date || '—'}`;
      const 摘要 = [`${条.school} · ${条.title}`, 条.content || '（没写简介）', `报名方式：${条.signup || '未填写'}`, `起止：${起止}`];
      return 建('tr', {},
        建('td', {}, 条.school),
        建('td', { class: '可换行' }, 建('b', {}, 条.title), 建('div', { class: '次要' }, 条.content || '（没写简介）')),
        建('td', { class: '可换行' }, 条.signup || '未填写'),
        建('td', {}, 起止),
        状态格(建, 条),
        建('td', {}, 按钮们('校赛', 条, 摘要, 控制)));
    })))));
}

export function 呈现(容器, 数据, 控制) {
  const { 改条件, 重新读取, 建, 占位 } = 控制;
  if (!数据.接好了) {
    占位({ 来源: 数据.来源, 要做: ['美国还没配用户副本（DB_DIR/用户副本.db），或北京还没开始同步校赛两张表'] });
    return;
  }
  容器.append(建('p', { class: '标签说明' }, '学校老师申请当校赛管理员、管理员提交的校赛，都要在这里审核：管理员申请通过后才能发校赛，校赛通过（已发布）后小程序里才看得到。拒绝、下架要写原因，负责人看得到。结果写回北京；列表每分钟从北京同步一次。'));
  if (数据.结果) 容器.append(建('div', { class: '状态' }, 数据.结果));
  容器.append(建('div', { class: '工具条' },
    建('select', { 'aria-label': '视图', onchange: e => 改条件({ 视图: e.target.value }) }, 数据.视图们.map(名 => 建('option', { value: 名, selected: 数据.视图 === 名 }, 名))),
    建('button', { type: 'button', onclick: () => 重新读取() }, '刷新')));
  画申请们(容器, 数据, 控制);
  画校赛们(容器, 数据, 控制);
}
