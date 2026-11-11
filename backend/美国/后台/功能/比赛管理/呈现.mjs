// 比赛管理 · 呈现（浏览器里跑）：左上角新建、搜索、状态筛选；一级比赛一行，届次缩进列在下面，每行只有名称和状态。
// 每行右边“修改”（弹出给用户看的字段，点确定经 比赛.编辑、届次.编辑 写进比赛库）、“删除”（进回收站）；一级比赛右边还有“新建”（在它下面加一届）；届次的状态在列表里直接改
// 一级比赛显示最新维护时间，左边的勾选框多选后点“AI 维护选中”排进队列（2026-11-06 用户定）。
// 动作都经 控制.提交 交给 数据库.mjs；失败时编辑框不关，把原因写在框里。
// 届次的编辑框里还有“封面海报”一栏：选了图先经 控制.发请求 存进图片总库，海报、候选图随“确定”一起保存。
// 点一级比赛的名称展开、再点收起，展开时在比赛行下面显示它的搜索记忆（2026-11-07）：第一次展开时经 控制.发请求 取，之后用取到的，点“刷新”重取；只看不改。
// 维护时间按最新一条新维护着色（成功绿、失败红），只有点维护时间才在比赛行下面展开维护详情（摘要、时间、原因、入库、改动、过程），再点收起（2026-11-08）：
// 详情第一次展开时经 控制.发请求 { 动作: '读维护详情', 编号 } 取（连同改动用到的届次名、字段说明一起交回），列表本身只带 最新新维护 { 成功, 摘要, 时间 }。
import { 表单初值, 表单转改动, 是海报比例, 描述比例, 压到上限, 加候选, 删候选, 维护状态, 搜索记忆展示, 维护标记, 维护详情展示 } from './整理.mjs';

let 正在搜索 = false;   // 边打字边筛会重画整块，重画后把光标放回搜索框
const 已选 = new Set();   // 勾选的比赛：搜索、筛选重画后还留着
const 一次最多 = 50;
const 展开了 = new Set();   // 展开看搜索记忆的比赛：搜索、筛选、保存后重画还展开着
const 记忆缓存 = new Map();   // 比赛编号 → 取到的搜索记忆；收起时扔掉，下次展开重取
const 维护展开了 = new Set();   // 点开维护时间看详情的比赛：重画后还展开着
const 详情缓存 = new Map();   // “比赛编号|最新新维护的时间” → 读维护详情交回的结果（详情、届次名、字段说明）；收起再展开不重取，有新的维护记录时间变了才重取

export function 呈现(容器, 数据, { 条件, 改条件, 提交, 发请求, 重新读取, 建 }) {
  const 海报 = { 规格: 数据.海报规格, 发请求 };
  const 出错就提示 = async 做 => {
    try { await 做(); } catch (错误) { window.alert(错误?.message || 错误); 重新读取(); }
  };
  const 本页比赛 = 数据.组们.map(g => g.比赛.id);
  const AI按钮 = 建('button', { type: 'button', class: '主按钮', disabled: !已选.size, onclick: () => {
    const 编号们 = [...已选];
    if (!window.confirm(`让 AI 维护选中的 ${编号们.length} 个比赛？每个比赛约几分钟，会调用 Codex 额度。`)) return;
    已选.clear();   // 提交成功后整块会重画，先清掉；失败了放回去
    出错就提示(async () => {
      try { await 提交({ 动作: '启动AI维护', 编号们 }); } catch (错误) { 编号们.forEach(编号 => 已选.add(编号)); throw 错误; }
    });
  } }, `AI 维护选中（${已选.size}）`);
  const 更新AI按钮 = () => { AI按钮.textContent = `AI 维护选中（${已选.size}）`; AI按钮.disabled = !已选.size; };
  const 搜索 = 建('input', { type: 'search', placeholder: '搜比赛名称、别名、届次', value: 数据.关键词 || '', 'aria-label': '搜索' });
  搜索.addEventListener('input', () => { 正在搜索 = true; 改条件({ 关键词: 搜索.value }); });
  const 筛选 = 建('select', { 'aria-label': '按状态筛选', onchange: 事件 => 改条件({ 状态: 事件.target.value }) },
    数据.筛选项.map(([名, 数]) => 建('option', { value: 名, selected: 名 === 数据.状态 }, `${名} ${数}`)));
  容器.append(建('div', { class: '工具栏' },
    建('button', { type: 'button', class: '主按钮', onclick: () => 打开编辑框(容器, 建, { 标题: '新建比赛', 字段们: 数据.字段表.比赛, 原: {}, 提交: 内容 => 提交({ 动作: '新建比赛', 内容 }) }) }, '新建'),
    搜索, 筛选,
    建('button', { type: 'button', onclick: () => {
      const 全选了 = 本页比赛.length && 本页比赛.every(编号 => 已选.has(编号));
      if (全选了) 本页比赛.forEach(编号 => 已选.delete(编号));
      else if (new Set([...已选, ...本页比赛]).size > 一次最多) { window.alert(`一次最多选 ${一次最多} 个比赛，这一页有 ${本页比赛.length} 个，先用搜索或筛选缩小范围`); return; }
      else 本页比赛.forEach(编号 => 已选.add(编号));
      重新读取();
    } }, '全选本页'),
    AI按钮));
  if (正在搜索) { 正在搜索 = false; 搜索.focus(); 搜索.setSelectionRange(搜索.value.length, 搜索.value.length); }
  if (数据.提示) 容器.append(建('div', { class: '提示条' }, 数据.提示));

  if (!数据.组们.length) {
    容器.append(建('div', { class: '状态' }, 条件.关键词 ? `没有找到“${条件.关键词}”` : '没有符合条件的比赛'));
    return;
  }
  const 行们 = 数据.组们.flatMap(({ 比赛, 届次们 }) => [
    建('div', { class: '一级行' },
      建('input', { type: 'checkbox', class: '选比赛', 'aria-label': `选中${比赛.name}`, checked: 已选.has(比赛.id), onchange: 事件 => {
        if (事件.target.checked && 已选.size >= 一次最多) { 事件.target.checked = false; window.alert(`一次最多选 ${一次最多} 个比赛`); return; }
        if (事件.target.checked) 已选.add(比赛.id); else 已选.delete(比赛.id);
        更新AI按钮();
      } }),
      建('button', { type: 'button', class: '名称 展开', 'aria-expanded': 展开了.has(比赛.id) ? 'true' : 'false', title: '展开看搜索记忆', onclick: () => {
        if (展开了.has(比赛.id)) { 展开了.delete(比赛.id); 记忆缓存.delete(比赛.id); } else 展开了.add(比赛.id);
        改条件({});   // 只重画，不重新取整个列表
      } }, 建('span', { class: '展开符', 'aria-hidden': 'true' }, 展开了.has(比赛.id) ? '▾' : '▸'), 比赛.name),
      维护状态(比赛.id, 数据.AI维护) ? 建('span', { class: '维护状态' }, 维护状态(比赛.id, 数据.AI维护)) : null,
      画维护时间(建, 比赛, () => 改条件({})),
      建('span', { class: '行尾' },
        建('button', { type: 'button', onclick: () => 打开编辑框(容器, 建, { 标题: `修改比赛“${比赛.name}”`, 字段们: 数据.字段表.比赛, 原: 比赛,
          提交: 改动 => 提交({ 动作: '编辑比赛', 编号: 比赛.id, 改动, 版本号: 比赛.version }) }) }, '修改'),
        建('button', { type: 'button', onclick: () => 打开编辑框(容器, 建, { 标题: `在“${比赛.name}”下新建一届`, 字段们: 数据.字段表.届次, 原: {}, 海报,
          提交: 内容 => 提交({ 动作: '新建届次', 比赛id: 比赛.id, 内容 }) }) }, '新建'),
        建('button', { type: 'button', class: '危险', onclick: () => {
          const 连同 = 比赛.届次们.length ? `和它的 ${比赛.届次们.length} 届` : '';
          if (window.confirm(`删除“${比赛.name}”${连同}？删除后移到回收站，30 天内可以恢复。`)) 出错就提示(() => 提交({ 动作: '删除比赛', 编号: 比赛.id }));
        } }, '删除'))),
    维护展开了.has(比赛.id) && 维护标记(比赛).可展开 ? 画维护详情(建, 比赛, 发请求) : null,
    展开了.has(比赛.id) ? 画搜索记忆(建, 比赛.id, 发请求) : null,
    ...届次们.map(届次 => 建('div', { class: '二级行' },
      建('span', { class: '名称' }, 届次.edition_name),
      建('select', { class: `状态标签 ${届次.status}`, 'aria-label': '状态', title: 届次.status_reason?.join('；') || '',
        onchange: 事件 => 出错就提示(() => 提交({ 动作: '改状态', 编号: 届次.id, 状态: 事件.target.value, 版本号: 届次.version })) },
        数据.状态们.map(名 => 建('option', { value: 名, selected: 名 === 届次.status }, 名))),
      建('span', { class: '行尾' },
        建('button', { type: 'button', onclick: () => 打开编辑框(容器, 建, { 标题: `修改“${届次.edition_name}”`, 字段们: 数据.字段表.届次, 原: 届次, 理由: 届次.status_reason, 海报,
          提交: 改动 => 提交({ 动作: '编辑届次', 编号: 届次.id, 改动, 版本号: 届次.version }) }) }, '修改'),
        建('button', { type: 'button', class: '危险', onclick: () => {
          if (window.confirm(`删除“${届次.edition_name}”？删除后移到回收站，30 天内可以恢复。`)) 出错就提示(() => 提交({ 动作: '删除届次', 编号: 届次.id }));
        } }, '删除')))),
  ]);
  容器.append(建('div', { class: '两级列表' }, 行们));
}

// 浏览器的 replaceChildren 收到 null 会画出文字“null”：先去掉空的（建 自己会跳过，replaceChildren 不会）
const 换内容 = (块, ...子) => 块.replaceChildren(...子.flat().filter(项 => 项 != null && 项 !== false));

// 维护时间（2026-11-08 用户定）：最新一条新维护成功是绿色、失败是红色，画成按钮，点开在比赛行下面看详情、再点收起；
// 没有新维护记录、没写成功、没维护过的照旧是灰色文字，不能点。
function 画维护时间(建, 比赛, 重画) {
  const 标记 = 维护标记(比赛);
  if (!标记.可展开) return 建('span', { class: '维护时间', title: '上次 AI 维护的时间（北京时间）' }, 标记.文字);
  const 开着 = 维护展开了.has(比赛.id);
  return 建('button', { type: 'button', class: `维护时间 可展开 ${标记.颜色}`, title: '点开看维护详情', 'aria-expanded': 开着 ? 'true' : 'false', onclick: () => {
    if (开着) 维护展开了.delete(比赛.id); else 维护展开了.add(比赛.id);
    重画();   // 只重画，不重新取整个列表
  } }, 标记.文字);
}

// 维护详情面板：第一次展开时经 控制.发请求 取；取过的按“比赛编号 + 这条记录的时间”留着，有了新的维护记录才重取
function 画维护详情(建, 比赛, 发请求) {
  const 编号 = 比赛.id;
  const 键 = `${编号}|${比赛.最新新维护?.时间 ?? ''}`;
  const 块 = 建('div', { class: '维护详情', role: 'region', 'aria-label': '维护详情' }, 建('div', { class: '次要' }, '正在读维护详情…'));
  const 网址 = 文字 => (/^https?:\/\/\S+$/.test(文字) ? 建('a', { href: 文字, target: '_blank', rel: 'noopener noreferrer' }, 文字) : 文字);
  const 一行 = (名, 内容) => 建('div', { class: '详情项' }, 建('span', { class: '详情名' }, 名), 建('span', { class: '详情值' }, 内容));
  const 画 = ({ 详情, 届次名, 字段说明 } = {}) => {
    const 展示 = 维护详情展示(详情, { 届次名, 字段说明 });
    if (!展示.有) { 块.replaceChildren(建('div', { class: '次要' }, 展示.说明)); return; }
    换内容(块,
      建('div', { class: '详情头' }, 建('strong', { class: 展示.颜色 }, 展示.摘要 || '（没写摘要）'), 建('span', { class: '次要' }, 展示.时间)),
      展示.结果 ? 一行('结果', 展示.结果) : null,
      展示.原因 ? 一行('原因', 展示.原因) : null,
      展示.入库.length ? 建('section', {}, 建('h4', {}, `入库（${展示.入库.length}）`),
        建('ul', {}, 展示.入库.map(项 => 建('li', {}, 网址(项.网址), 项.状态 ? ` · ${项.状态}` : '', 项.原因 ? ` · ${项.原因}` : '')))) : null,
      // 改动（2026-11-08）：按届次分组，每条“字段：改前 → 改后”，下面一行是依据的通知；没有改动不画
      展示.改动数 ? 建('section', { class: '维护改动' }, 建('h4', {}, `改动（${展示.改动数} 处）`),
        展示.改动.map(组 => 建('div', { class: '改动组' }, 建('div', { class: '改动届次' }, 组.届次),
          建('ul', {}, 组.条们.map(条 => 建('li', {},
            建('span', { class: '详情名' }, `${条.字段}：`), 建('span', { class: '改前' }, 条.改前), ' → ', 建('span', { class: '改后' }, 条.改后),
            条.网址 ? 建('div', { class: '改动依据 次要' }, '依据 ', 网址(条.网址)) : null)))))) : null,
      展示.过程.length ? 建('section', {}, 建('h4', {}, '过程'),
        建('ol', {}, 展示.过程.map(项 => 建('li', {}, 建('span', { class: '详情名' }, `${项.步骤}：`), 项.说明)))) : null);
  };
  async function 读() {
    try {
      const { 结果 } = await 发请求({ 动作: '读维护详情', 编号 });
      详情缓存.set(键, 结果);
      画(结果);
    } catch (错误) {
      块.replaceChildren(建('div', { class: '错误栏' }, `读不出维护详情：${错误?.message || 错误}`), 建('button', { type: 'button', onclick: () => 读() }, '重试'));
    }
  }
  if (详情缓存.has(键)) 画(详情缓存.get(键)); else 读();
  return 块;
}

// 搜索记忆面板：按比赛库给的节名逐节画（不写死节名，新加的“维护记录”跟着出来），空的节写“还没有”；网址画成链接（新窗口打开）
function 画搜索记忆(建, 编号, 发请求) {
  const 块 = 建('div', { class: '搜索记忆', role: 'region', 'aria-label': '搜索记忆' }, 建('div', { class: '次要' }, '正在读搜索记忆…'));
  const 一条 = 条 => {
    const 网址 = /^https?:\/\/\S+/.exec(条)?.[0];
    return 建('li', {}, 网址 ? [建('a', { href: 网址, target: '_blank', rel: 'noopener noreferrer' }, 网址), 条.slice(网址.length)] : 条);
  };
  const 画 = ({ 节名, 记忆 }) => {
    const 展示 = 搜索记忆展示(记忆, 节名);
    换内容(块,
      建('div', { class: '记忆头' }, 建('strong', {}, '搜索记忆'), 建('span', { class: '次要' }, 展示.说明), 建('button', { type: 'button', onclick: () => 读() }, '刷新')),
      展示.有 ? 建('div', { class: '记忆节们' }, 展示.节们.map(节 => 建('section', { class: '记忆节' }, 建('h4', {}, 节.名),
        节.条目们.length ? 建('ul', {}, 节.条目们.map(一条)) : 建('div', { class: '次要' }, '还没有')))) : null);
  };
  async function 读() {
    try {
      const { 结果 } = await 发请求({ 动作: '读搜索记忆', 编号 });
      记忆缓存.set(编号, 结果);
      画(结果);
    } catch (错误) {
      块.replaceChildren(建('div', { class: '错误栏' }, `读不出搜索记忆：${错误?.message || 错误}`), 建('button', { type: 'button', onclick: () => 读() }, '重试'));
    }
  }
  if (记忆缓存.has(编号)) 画(记忆缓存.get(编号)); else 读();
  return 块;
}

// 编辑框：按字段表画表单，初值来自原记录；点确定才交给 提交（只交真正变了的）。新建时 原 是 {}。
function 打开编辑框(容器, 建, { 标题, 字段们, 原, 理由 = [], 海报 = null, 提交 }) {
  const 控件们 = new Map();
  const 一项 = 字段 => {
    const 初值 = 表单初值(字段, 原[字段.字段]);
    let 控件;
    if (字段.类型 === '是否') 控件 = 建('input', { type: 'checkbox', checked: 初值 });
    else if (字段.类型 === '列表' && 字段.可选值) {
      控件 = 建('span', { class: '多选' }, 字段.可选值.map(项 => 建('label', {}, 建('input', { type: 'checkbox', value: 项, checked: 初值.includes(项) }), 项)));
    } else if (字段.可选值) {
      // 选填的可以不填；必填的在新建时（还没有值）也先空着，免得默认选上第一项
      const 空项 = !字段.必填 ? ['（不填）'] : 初值 === '' ? ['请选择'] : [];
      控件 = 建('select', {}, 空项.map(文字 => 建('option', { value: '' }, 文字)), 字段.可选值.map(项 => 建('option', { value: 项, selected: 项 === 初值 }, 项)));
    } else if (字段.类型 === '长文字' || 字段.类型 === '对象') {
      控件 = 建('textarea', { rows: 字段.类型 === '对象' ? '6' : '3', class: 字段.类型 === '对象' ? '代码' : null });
      控件.value = 初值;
    } else {
      控件 = 建('input', { type: 'text', value: 初值, inputmode: 字段.类型 === '整数' ? 'numeric' : null, placeholder: 字段.类型 === '日期或时间' ? '如 2026-11-30' : null });
    }
    控件们.set(字段.字段, 控件);
    return 建('label', { class: '表单项' }, 建('span', { title: 字段.说明 }, 字段.标签, 字段.必填 ? ' *' : ''), 控件);
  };
  const 读输入 = () => Object.fromEntries([...控件们].map(([名, 控件]) => [名,
    控件.classList.contains('多选') ? [...控件.querySelectorAll('input:checked')].map(框 => 框.value)
      : 控件.type === 'checkbox' ? 控件.checked : 控件.value]));

  const 海报栏 = 海报 ? 画海报栏(建, 原, 海报) : null;
  const 错误栏 = 建('div', { class: '错误栏', role: 'alert' });
  const 确定 = 建('button', { type: 'submit', class: '主按钮' }, '确定');
  const 框 = 建('dialog', { class: '编辑框' },
    建('form', { method: 'dialog', onsubmit: async 事件 => {
      事件.preventDefault();
      错误栏.textContent = '';
      let 改动;
      try { 改动 = { ...表单转改动(字段们, 原, 读输入()), ...(海报栏?.改动() || {}) }; } catch (错误) { 错误栏.textContent = 错误.message; return; }
      if (!Object.keys(改动).length) { 框.close(); return; }
      确定.disabled = true;
      try { await 提交(改动); 框.close(); } catch (错误) { 错误栏.textContent = `没保存：${错误?.message || 错误}`; } finally { 确定.disabled = false; }
    } },
      建('h3', {}, 标题),
      理由?.length ? 建('div', { class: '提示条' }, `待人工审核的理由：${理由.join('；')}`) : null,
      建('div', { class: '表单' }, 字段们.map(一项)),
      海报栏?.元素,
      错误栏,
      建('div', { class: '按钮行' }, 建('button', { type: 'button', onclick: () => 框.close() }, '取消'), 确定)));
  框.addEventListener('close', () => 框.remove());
  容器.append(框);
  框.showModal();
}

// 封面海报（2026-10-24 用户定）：只收 16:9 的图（宽高比 1.76～1.79），缩成 640×360、压到 60 KB 以内设为海报；
// 不是 16:9 的原图放进候选图片，只留着备查，不给学生看。图片先存进图片总库，海报和候选图随“确定”一起保存。
// 从旧后台 apps/admin/src/PosterField.tsx 搬来。
function 画海报栏(建, 原, { 规格, 发请求 }) {
  let 当前海报 = 原.poster ?? null;
  let 候选们 = 原.poster_candidates ?? [];
  const 来源 = 建('select', {}, 建('option', { value: 'manual' }, '人工上传'), 建('option', { value: 'official' }, '官网原图'));
  const 来源网址 = 建('input', { type: 'text', placeholder: '官网原图填图片所在页面' });
  const 选图 = 建('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
  const 消息 = 建('div', { class: '海报消息' });
  const 现状 = 建('div', { class: '海报现状' });
  const 预览 = (文件, 宽) => 建('img', { src: `./海报/${文件}`, alt: '海报预览', width: String(宽) });
  const 来源说明 = 项 => (项.source === 'official' ? '官网原图' : '人工上传') + (项.sourceUrl ? ` · ${项.sourceUrl}` : '');

  function 画现状() {
    现状.replaceChildren(
      建('div', { class: '海报块' }, 建('strong', {}, '当前海报'),
        当前海报 ? [预览(当前海报.file, 320), 建('div', { class: '次要' }, `${来源说明(当前海报)} · ${String(当前海报.updatedAt || '').slice(0, 10)}`),
          建('button', { type: 'button', class: '危险', onclick: () => { 当前海报 = null; 消息.textContent = '已去掉海报，点“确定”后生效（小程序改回文字封面）'; 画现状(); } }, '去掉海报')]
          : 建('div', { class: '次要' }, '还没有海报，小程序显示文字封面。')),
      建('div', { class: '海报块' }, 建('strong', {}, `候选图片（${候选们.length}）`),
        候选们.length ? 候选们.map(项 => 建('div', { class: '候选项' }, 预览(项.file, 160),
          建('span', { class: '次要' }, `${描述比例(项.width, 项.height)} · ${Math.round(项.bytes / 1024)} KB · ${来源说明(项)}`),
          建('button', { type: 'button', class: '危险', onclick: () => { 候选们 = 删候选(候选们, 项.file); 画现状(); } }, '删除')))
          : 建('div', { class: '次要' }, '暂无。')));
  }

  选图.addEventListener('change', async () => {
    const 文件 = 选图.files?.[0];
    选图.value = '';
    if (!文件) return;
    消息.textContent = '正在处理图片…';
    try {
      const 图 = await 读图(文件);
      const 现在 = new Date().toISOString();
      const 出处 = { source: 来源.value, sourceUrl: 来源网址.value.trim() };
      if (是海报比例(规格, 图.naturalWidth, 图.naturalHeight)) {
        const 压好 = await 压到上限(质量 => 画成海报(图, 规格, 质量), 规格.最大字节);
        if (!压好) throw new Error('这张图压到 60 KB 以内会太糊，请换一张细节少一些的图');
        const { 结果 } = await 发请求({ 动作: '存图片', 图片: await 转成文字(压好.图), 种类: '海报' });
        当前海报 = { file: 结果.文件, ...出处, updatedAt: 现在 };
        消息.textContent = `已设为海报：原图 ${描述比例(图.naturalWidth, 图.naturalHeight)}，压成 ${规格.宽} × ${规格.高}、${Math.round(结果.字节 / 1024)} KB。点“确定”后生效。`;
      } else {
        if (文件.size > 规格.候选最大字节) throw new Error('不是 16:9，而且超过 5 MB，候选图片也存不下');
        const { 结果 } = await 发请求({ 动作: '存图片', 图片: await 转成文字(文件), 种类: '候选' });
        候选们 = 加候选(候选们, { file: 结果.文件, width: 结果.宽, height: 结果.高, bytes: 结果.字节, ...出处, addedAt: 现在 }, 规格.最多候选);
        消息.textContent = `这张图是 ${描述比例(图.naturalWidth, 图.naturalHeight)}，不是 16:9，已放进候选图片，不会显示给学生。点“确定”后生效。`;
      }
      画现状();
    } catch (错误) {
      消息.textContent = 错误?.message || '上传失败，请重试';
    }
  });

  画现状();
  const 元素 = 建('fieldset', { class: '海报栏' }, 建('legend', {}, '封面海报'),
    建('div', { class: '次要' }, `只收 16:9 的图（宽高比 1.76～1.79），会自动缩成 ${规格.宽} × ${规格.高}、压到 60 KB 以内；不是 16:9 的放进候选图片，只留着备查。只用主办方发布的宣传图或项目组自己做的图。`),
    建('label', { class: '表单项' }, 建('span', {}, '图片来源'), 来源),
    建('label', { class: '表单项' }, 建('span', {}, '来源网址'), 来源网址),
    建('label', { class: '表单项' }, 建('span', {}, '选择图片'), 选图),
    消息, 现状);
  // 只交回真正变了的（候选图空列表和没有算一样）
  const 一样 = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const 空成null = 列表 => (列表?.length ? 列表 : null);
  const 改动 = () => ({
    ...(一样(当前海报, 原.poster) ? {} : { poster: 当前海报 }),
    ...(一样(空成null(候选们), 空成null(原.poster_candidates)) ? {} : { poster_candidates: 空成null(候选们) }),
  });
  return { 元素, 改动 };
}

function 读图(文件) {
  return new Promise((成功, 失败) => {
    const 地址 = URL.createObjectURL(文件);
    const 图 = new Image();
    图.onload = () => { URL.revokeObjectURL(地址); 成功(图); };
    图.onerror = () => { URL.revokeObjectURL(地址); 失败(new Error('读不出这张图，请换 JPG、PNG 或 WebP')); };
    图.src = 地址;
  });
}

// 画到 640×360 的画布上导出 JPG（比例已在 1.76～1.79 之间，拉伸不超过 1%）
function 画成海报(图, 规格, 质量) {
  const 画布 = document.createElement('canvas');
  画布.width = 规格.宽; 画布.height = 规格.高;
  const 笔 = 画布.getContext('2d');
  if (!笔) return Promise.reject(new Error('浏览器不支持图片处理'));
  笔.fillStyle = '#ffffff';
  笔.fillRect(0, 0, 规格.宽, 规格.高);
  笔.drawImage(图, 0, 0, 规格.宽, 规格.高);
  return new Promise((成功, 失败) => 画布.toBlob(结果 => (结果 ? 成功(结果) : 失败(new Error('压缩失败'))), 'image/jpeg', 质量));
}

function 转成文字(文件) {
  return new Promise((成功, 失败) => {
    const 读 = new FileReader();
    读.onload = () => 成功(String(读.result));
    读.onerror = () => 失败(new Error('读取图片失败'));
    读.readAsDataURL(文件);
  });
}
