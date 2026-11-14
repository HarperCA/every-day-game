// 总览顶上的“维护进度”（2026-11-12 用户定：旧 AI 审查删掉，后台手动勾选的改由新维护处理；这里显示新维护队列的进度），自己每 5 秒刷新。
// 数据经 控制.发请求 { 动作: '维护进度' } 从维护队列读（db/操作/维护队列.mjs 的 读进度）：
//   { 正在: [{ 比赛编号, 名称, 开始时间 }], 排队数, 排队: [{ 比赛编号, 名称 }]（最多 50 个）, 最近: [{ 名称, 成功, 摘要, 原因, 时间 }]（最多 30 个）, 暂停到 }
//   进度摘要(数据) → 折叠时显示的一行（纯计算）
//   画维护进度(容器, { 发请求, 建 })
const 刷新间隔 = 5000;
const 北京时间 = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const 显示时间 = 值 => (值 ? 北京时间.format(new Date(值)) : '');

const 完成数 = 最近 => {
  const 成功 = 最近.filter(x => x.成功).length;
  return `最近完成 ${最近.length} 个（成功 ${成功}，失败 ${最近.length - 成功}）`;
};

export function 进度摘要({ 正在 = [], 排队数 = 0, 最近 = [], 暂停到 = null } = {}) {
  if (正在.length) return ['维护中 · ' + 正在.map(x => x.名称).join('、'), 排队数 ? `还有 ${排队数} 个排队` : '', 最近.length ? 完成数(最近) : ''].filter(Boolean).join(' · ');
  if (暂停到 && 排队数) return `维护暂停 · ${排队数} 个等额度恢复`;
  if (排队数) return `排队中 · ${排队数} 个`;
  return 最近.length ? `维护进度 · ${完成数(最近)}` : '维护进度';
}

const 结果文字 = x => [x.成功 ? '成功' : '失败', x.摘要, x.原因].filter(Boolean).join(' · ');

export function 画维护进度(容器, { 发请求, 建 }) {
  const 摘要 = 建('summary', {}, '维护进度');
  const 内容 = 建('div', { class: '维护进度内容' }, 建('p', {}, '正在读取维护进度…'));
  const 面板 = 建('details', { class: '维护进度' }, 摘要, 内容);
  容器.append(面板);

  let 定时;
  let 读取中 = false;
  let 上次;
  const 设置摘要 = 值 => { if (摘要.textContent !== 值) 摘要.textContent = 值; };
  const 画 = 数据 => {
    const { 正在, 排队数, 排队, 最近, 暂停到 } = 数据;
    设置摘要(进度摘要(数据));
    内容.replaceChildren(
      ...(正在.length
        ? [建('h3', {}, `正在维护（${正在.length}）`), 建('ul', {}, 正在.map(x => 建('li', {}, x.名称 + (x.开始时间 ? ' · 开始于 ' + 显示时间(x.开始时间) : ''))))]
        : [建('p', {}, '当前没有正在维护的比赛。')]),
      ...(暂停到 ? [建('p', {}, 'AI 额度不足，预计 ' + 显示时间(暂停到) + '（北京时间）后接着维护。')] : []),
      ...(排队数 ? [建('h3', {}, `排队中（${排队数}）`),
        建('ol', {}, 排队.map(x => 建('li', {}, x.名称))),
        ...(排队数 > 排队.length ? [建('p', {}, `还有 ${排队数 - 排队.length} 个没列出`)] : [])] : []),
      ...(最近.length ? [建('h3', {}, 完成数(最近)),
        建('ul', {}, 最近.map(x => 建('li', {}, 建('span', { class: x.成功 ? '成功' : '失败' }, x.名称), ' · ' + 结果文字(x) + (x.时间 ? ' · ' + 显示时间(x.时间) : ''))))] : []));
  };

  async function 刷新() {
    if (读取中 || !面板.isConnected) return;
    clearTimeout(定时);
    读取中 = true;
    try {
      if (document.hidden) return;
      const 数据 = await 发请求({ 动作: '维护进度' });
      if (!面板.isConnected) return;
      const 新的 = JSON.stringify(数据);
      if (新的 !== 上次) { 画(数据); 上次 = 新的; }
    } catch {
      if (!面板.isConnected) return;
      上次 = undefined;
      设置摘要('维护进度 · 暂时无法读取');
      内容.replaceChildren(建('p', {}, '暂时无法读取维护进度，稍后会自动重试。'));
    } finally {
      读取中 = false;
      if (面板.isConnected) 定时 = setTimeout(刷新, 刷新间隔);
    }
  }
  面板.addEventListener('toggle', () => { if (面板.open) void 刷新(); });
  void 刷新();
}
