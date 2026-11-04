// 环形图：中间是总数，外面一圈按类型分成扇环，旁边是图例和每类的说明。
// 点一段扇环（或图例里的一行）：中间换成这一类的数量，下面显示它的说明；点中间回到总数。
//
//   画环形图(容器, { 总数, 单位, 分组: [{ 名称, 数量, 说明 }], 标题 })
//   算扇环(分组, { 外半径, 内半径, 间隙度 })   纯计算，不碰页面（测试直接用）
const 色 = i => `var(--色${(i % 6) + 1})`;
const NS = 'http://www.w3.org/2000/svg';

const 点 = (半径, 角度) => {
  const 弧度 = (角度 - 90) * Math.PI / 180;
  return [120 + 半径 * Math.cos(弧度), 120 + 半径 * Math.sin(弧度)];
};

export function 算扇环(分组, { 外半径 = 104, 内半径 = 70, 间隙度 = 1.2 } = {}) {
  const 总数 = 分组.reduce((和, 组) => 和 + Math.max(0, 组.数量), 0);
  if (!总数) return [];
  let 起 = 0;
  return 分组.map((组, i) => {
    const 跨度 = (Math.max(0, 组.数量) / 总数) * 360;
    const 止 = 起 + 跨度;
    // 只有一类时画成整圈（SVG 的弧画不了正好 360 度，拆成两半）
    const 留缝 = 分组.filter(g => g.数量 > 0).length > 1 ? Math.min(间隙度, 跨度 / 3) : 0;
    const a = 起 + 留缝 / 2, b = 止 - 留缝 / 2;
    const 大弧 = b - a > 180 ? 1 : 0;
    let d;
    if (跨度 >= 359.999) {
      const [x1, y1] = 点(外半径, 0), [x2, y2] = 点(外半径, 180), [x3, y3] = 点(内半径, 180), [x4, y4] = 点(内半径, 0);
      d = `M${x1} ${y1}A${外半径} ${外半径} 0 1 1 ${x2} ${y2}A${外半径} ${外半径} 0 1 1 ${x1} ${y1}M${x4} ${y4}A${内半径} ${内半径} 0 1 0 ${x3} ${y3}A${内半径} ${内半径} 0 1 0 ${x4} ${y4}Z`;
    } else {
      const [x1, y1] = 点(外半径, a), [x2, y2] = 点(外半径, b), [x3, y3] = 点(内半径, b), [x4, y4] = 点(内半径, a);
      d = `M${x1} ${y1}A${外半径} ${外半径} 0 ${大弧} 1 ${x2} ${y2}L${x3} ${y3}A${内半径} ${内半径} 0 ${大弧} 0 ${x4} ${y4}Z`;
    }
    const 段 = { ...组, 序号: i, 起: a, 止: b, 占比: 组.数量 / 总数, d };
    起 = 止;
    return 段;
  });
}

const 百分比 = 比 => `${(比 * 100).toFixed(比 < 0.01 && 比 > 0 ? 1 : 0)}%`;

export function 画环形图(容器, { 总数, 单位 = '', 分组, 标题 = '总数' }) {
  const 段们 = 算扇环(分组);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 240 240');
  svg.setAttribute('class', '环形图');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${标题} ${总数}${单位}，${分组.map(g => `${g.名称} ${g.数量}`).join('，')}`);

  const 路径们 = 段们.map(段 => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 段.d);
    p.setAttribute('fill', 色(段.序号));
    p.setAttribute('tabindex', '0');
    p.setAttribute('class', '扇环');
    p.append(Object.assign(document.createElementNS(NS, 'title'), { textContent: `${段.名称} ${段.数量}${单位}（${百分比(段.占比)}）` }));
    p.addEventListener('click', 事件 => { 事件.stopPropagation(); 选中(段.序号); });
    p.addEventListener('keydown', 事件 => { if (事件.key === 'Enter' || 事件.key === ' ') { 事件.preventDefault(); 选中(段.序号); } });
    svg.append(p);
    return p;
  });

  const 中心 = document.createElementNS(NS, 'g');
  中心.setAttribute('class', '中心');
  const 圆 = document.createElementNS(NS, 'circle');
  Object.entries({ cx: 120, cy: 120, r: 66 }).forEach(([k, v]) => 圆.setAttribute(k, v));
  const 数字 = document.createElementNS(NS, 'text');
  Object.entries({ x: 120, y: 120, class: '中心数字' }).forEach(([k, v]) => 数字.setAttribute(k, v));
  const 名称 = document.createElementNS(NS, 'text');
  Object.entries({ x: 120, y: 148, class: '中心名称' }).forEach(([k, v]) => 名称.setAttribute(k, v));
  中心.append(圆, 数字, 名称);
  中心.addEventListener('click', () => 选中(null));
  svg.append(中心);

  const 图例 = document.createElement('ul');
  图例.className = '图例';
  const 行们 = 段们.map(段 => {
    const li = document.createElement('li');
    const 按钮 = document.createElement('button');
    按钮.type = 'button';
    按钮.innerHTML = `<i style="background:${色(段.序号)}"></i><span class="名"></span><span class="数"></span><span class="比"></span>`;
    按钮.querySelector('.名').textContent = 段.名称;
    按钮.querySelector('.数').textContent = `${段.数量}${单位}`;
    按钮.querySelector('.比').textContent = 百分比(段.占比);
    按钮.addEventListener('click', () => 选中(段.序号));
    const 说明 = document.createElement('p');
    说明.className = '说明';
    说明.textContent = 段.说明 || '';
    li.append(按钮, 说明);
    图例.append(li);
    return li;
  });

  const 布局 = document.createElement('div');
  布局.className = '环形图布局';
  布局.append(svg, 图例);
  容器.append(布局);

  let 当前 = null;
  function 选中(序号) {
    当前 = 当前 === 序号 ? null : 序号;
    路径们.forEach((p, i) => p.classList.toggle('淡', 当前 !== null && i !== 当前));
    行们.forEach((li, i) => li.classList.toggle('选中', i === 当前));
    if (当前 === null) {
      数字.textContent = `${总数}`;
      名称.textContent = `${标题}（${单位}）`;
    } else {
      const 段 = 段们[当前];
      数字.textContent = `${段.数量}`;
      名称.textContent = `${段.名称} · ${百分比(段.占比)}`;
    }
  }
  选中(null);
  return { 选中 };
}
