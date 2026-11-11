// 总览里的 AI 审核进度独立刷新。
const 刷新间隔 = 5000;
const 北京时间 = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const 显示时间 = 值 => 北京时间.format(new Date(值));

function 步骤文字({ 阶段, 届次, 届次序号, 届次总数, 轮次, 最多轮次 }) {
  const 轮 = 轮次 ? ' · 第 ' + 轮次 + '/' + 最多轮次 + ' 轮' : '';
  const 届 = 届次 ? ' · ' + 届次 + '（' + 届次序号 + '/' + 届次总数 + '）' : '';
  return 阶段 + 轮 + 届;
}

function 结果文字({ 状态, 结果, 步骤们 }) {
  if (结果?.说明) return 状态 + ' · ' + 结果.说明;
  if (状态 === '审核完成' && 结果) {
    return 状态 + ' · 改正 ' + 结果.改正 + ' 项，转人工 ' + 结果.人工 + ' 项，留待核实 ' + 结果.留着 + ' 项';
  }
  const 最后 = 步骤们?.at(-1);
  return 最后 ? 状态 + ' · ' + 最后.阶段 : 状态;
}

export function 画审核进度(容器, { 发请求, 建 }) {
  const 摘要 = 建('summary', {}, 'AI 审核进度');
  const 内容 = 建('div', { class: '审核进度内容' }, 建('p', {}, '正在读取审核进度…'));
  const 面板 = 建('details', { class: '审核进度' }, 摘要, 内容);
  容器.append(面板);

  let 定时;
  let 读取中 = false;
  let 上次;
  const 设置摘要 = 值 => { if (摘要.textContent !== 值) 摘要.textContent = 值; };
  const 画 = ({ 正在, 排队, 最近, 暂停到 }) => {
    const 当前步骤 = 正在?.步骤们.at(-1);
    设置摘要(正在 ? '审核中 · ' + 正在.名称 + ' · ' + 当前步骤.阶段
      : 暂停到 ? '审核暂停 · ' + 排队.length + ' 项等待重试'
        : 排队.length ? '排队中 · ' + 排队.length + ' 项' : 'AI 审核进度');
    const 在审核 = 正在 ? 建('section', {},
      建('h3', {}, 正在.名称),
      建('p', {}, (正在.来源 === '手动' ? '手动审核' : '自动审核') + ' · 开始于 ' + 显示时间(正在.开始时间)),
      建('ol', { class: '审核步骤' }, 正在.步骤们.map(步骤 => 建('li', {
        'aria-current': 步骤 === 当前步骤 ? 'step' : null,
      }, 建('time', { datetime: 步骤.时间 }, 显示时间(步骤.时间)), 步骤文字(步骤))))) : null;
    内容.replaceChildren(
      ...(在审核 ? [在审核] : [建('p', {}, '当前没有正在审核的比赛。')]),
      ...(暂停到 ? [建('p', {}, '审核额度不足，预计 ' + 显示时间(暂停到) + '（北京时间）后重试。')] : []),
      ...(排队.length ? [建('h3', {}, '等待审核'),
        建('ol', {}, 排队.map(比赛 => 建('li', {}, 比赛.名称)))] : []),
      ...(最近.length ? [建('h3', {}, '最近审核'),
        建('ul', {}, 最近.map(比赛 => 建('li', {}, 比赛.名称 + ' · ' + 结果文字(比赛))))] : []));
  };

  async function 刷新() {
    if (读取中 || !面板.isConnected) return;
    clearTimeout(定时);
    读取中 = true;
    try {
      if (document.hidden) return;
      const 数据 = await 发请求({ 动作: '审核进度' });
      if (!面板.isConnected) return;
      const 新的 = JSON.stringify(数据);
      if (新的 !== 上次) { 画(数据); 上次 = 新的; }
    } catch {
      if (!面板.isConnected) return;
      上次 = undefined;
      设置摘要('AI 审核进度 · 暂时无法读取');
      内容.replaceChildren(建('p', {}, '暂时无法读取审核进度，稍后会自动重试。'));
    } finally {
      读取中 = false;
      if (面板.isConnected) 定时 = setTimeout(刷新, 刷新间隔);
    }
  }
  面板.addEventListener('toggle', () => { if (面板.open) void 刷新(); });
  void 刷新();
}
