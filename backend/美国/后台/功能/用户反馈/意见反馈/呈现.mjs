// 意见反馈 · 呈现（浏览器里跑）：照旧后台 GeneralFeedbackModule.tsx 搬（2026-11-02）。按类型、状态筛；每条“处理”打开对话框，
// 改状态、写公开回复（用户可见）和内部备注（仅后台），点保存经 提交 写回北京；失败时对话框不关，填的内容还在。
const 时间 = 值 => 值 ? new Date(值).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '—';

function 打开处理框(条, 数据, { 提交, 建 }) {
  const 状态 = 建('select', { name: 'status' }, Object.entries(数据.状态们).map(([值, 名]) => 建('option', { value: 值, selected: 条.status === 值 }, 名)));
  const 回复 = 建('textarea', { name: 'public_reply', maxlength: 2000, placeholder: '说明已完成的处理或具体进展；已解决时必须填写。' });
  回复.value = 条.public_reply || '';
  const 备注 = 建('textarea', { name: 'internal_note', maxlength: 2000 });
  备注.value = 条.internal_note || '';
  const 出错 = 建('div', { class: '状态 出错', hidden: true });
  const 框 = 建('dialog', { class: '编辑框' });
  const 保存 = 建('button', { type: 'submit', class: '主要' }, '保存处理结果');
  框.append(建('form', { method: 'dialog', onsubmit: async e => {
    e.preventDefault();
    保存.disabled = true; 出错.hidden = true;
    try {
      await 提交({ 动作: '保存', 编号: 条.id, status: 状态.value, public_reply: 回复.value, internal_note: 备注.value, 读到的更新时间: 条.updated_at });
      框.close(); 框.remove();
    } catch (错误) {
      出错.textContent = String(错误?.message || 错误); 出错.hidden = false; 保存.disabled = false;
    }
  } },
  建('h3', {}, '处理意见反馈'),
  建('p', { class: '次要' }, `${条.类型} · ${时间(条.created_at)} · 账号 ${条.账号}`),
  建('p', { class: '可换行' }, 条.content),
  建('p', {}, `联系方式：${条.contact || '未填写'}`),
  建('label', {}, '处理状态', 状态),
  建('label', {}, '公开回复（用户可见）', 回复),
  建('label', {}, '内部备注（仅后台可见）', 备注),
  出错,
  建('div', { class: '按钮行' }, 建('button', { type: 'button', onclick: () => { 框.close(); 框.remove(); } }, '取消'), 保存)));
  document.body.append(框);
  框.showModal();
}

export function 呈现(容器, 数据, 控制) {
  const { 条件, 改条件, 重新读取, 建, 占位 } = 控制;
  if (!数据.接好了) {
    占位({ 来源: 数据.来源, 要做: ['美国还没配用户副本（DB_DIR/用户副本.db），或北京还没开始同步'] });
    return;
  }
  const 选 = (标签, 键, 选项们, 全部名) => 建('select', { 'aria-label': 标签, onchange: e => 改条件({ [键]: e.target.value }) },
    建('option', { value: '' }, 全部名), Object.entries(选项们).map(([值, 名]) => 建('option', { value: 值, selected: 条件[键] === 值 }, 名)));
  容器.append(建('p', { class: '标签说明' }, '用户对小程序本身的意见和问题。保存后的状态和公开回复写回北京，用户在“我的反馈”里看得到；内部备注只在后台看。列表每 10 分钟从北京同步一次。'));
  if (数据.结果) 容器.append(建('div', { class: '状态' }, 数据.结果));
  容器.append(建('div', { class: '工具条' },
    选('反馈类型', '类型', 数据.类型们, '全部类型'),
    选('处理状态', '状态', Object.fromEntries(Object.entries(数据.状态们).map(([值, 名]) => [值, `${名} ${数据.数量[值]}`])), `全部状态 ${数据.数量.全部}`),
    建('button', { type: 'button', onclick: () => 重新读取() }, '刷新')));
  if (!数据.条目们.length) { 容器.append(建('p', { class: '标签说明' }, '暂无符合条件的意见反馈。')); return; }
  容器.append(建('div', { class: '表格外框' }, 建('table', { class: '表格' },
    建('thead', {}, 建('tr', {}, ['类型 / 提交时间', '反馈内容', '联系方式', '处理状态 / 公开回复', '操作'].map(名 => 建('th', {}, 名)))),
    建('tbody', {}, 数据.条目们.map(条 => 建('tr', {},
      建('td', {}, 条.类型, 建('div', { class: '次要' }, 时间(条.created_at)), 建('div', { class: '次要' }, `账号 ${条.账号}`)),
      建('td', { class: '可换行' }, 条.content),
      建('td', {}, 条.contact || '未填写'),
      建('td', { class: '可换行' }, 建('b', {}, 条.状态), 建('div', {}, 条.public_reply || '尚未回复'), 建('div', { class: '次要' }, `更新：${时间(条.updated_at)}`)),
      建('td', {}, 建('button', { type: 'button', onclick: () => 打开处理框(条, 数据, 控制) }, '处理'))))))));
}
