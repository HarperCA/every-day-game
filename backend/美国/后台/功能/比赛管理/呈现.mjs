// 比赛管理 · 呈现（浏览器里跑）：左上角新建、搜索、状态筛选；一级比赛一行，届次缩进列在下面，每行只有名称和状态。
// 每行左边“编辑”（弹出表单，点确定才保存），右边“删除”（进回收站）；一级比赛右边还有“新建”（在它下面加一届）；届次的状态在列表里直接改。
// 动作都经 控制.提交 交给 数据库.mjs；失败时编辑框不关，把原因写在框里。
// 届次的编辑框里还有“封面海报”一栏：选了图先经 控制.发请求 存进图片总库，海报、候选图随“确定”一起保存。
import { 表单初值, 表单转改动, 是海报比例, 描述比例, 压到上限, 加候选, 删候选 } from './整理.mjs';

let 正在搜索 = false;   // 边打字边筛会重画整块，重画后把光标放回搜索框

export function 呈现(容器, 数据, { 条件, 改条件, 提交, 发请求, 重新读取, 建 }) {
  const 海报 = { 规格: 数据.海报规格, 发请求 };
  const 搜索 = 建('input', { type: 'search', placeholder: '搜比赛名称、别名、届次', value: 数据.关键词 || '', 'aria-label': '搜索' });
  搜索.addEventListener('input', () => { 正在搜索 = true; 改条件({ 关键词: 搜索.value }); });
  const 筛选 = 建('select', { 'aria-label': '按状态筛选', onchange: 事件 => 改条件({ 状态: 事件.target.value }) },
    数据.筛选项.map(([名, 数]) => 建('option', { value: 名, selected: 名 === 数据.状态 }, `${名} ${数}`)));
  容器.append(建('div', { class: '工具栏' },
    建('button', { type: 'button', class: '主按钮', onclick: () => 打开编辑框(容器, 建, { 标题: '新建比赛', 字段们: 数据.字段表.比赛, 原: {}, 提交: 内容 => 提交({ 动作: '新建比赛', 内容 }) }) }, '新建'),
    搜索, 筛选));
  if (正在搜索) { 正在搜索 = false; 搜索.focus(); 搜索.setSelectionRange(搜索.value.length, 搜索.value.length); }
  if (数据.提示) 容器.append(建('div', { class: '提示条' }, 数据.提示));

  if (!数据.组们.length) {
    容器.append(建('div', { class: '状态' }, 条件.关键词 ? `没有找到“${条件.关键词}”` : '没有符合条件的比赛'));
    return;
  }
  const 出错就提示 = async 做 => {
    try { await 做(); } catch (错误) { window.alert(错误?.message || 错误); 重新读取(); }
  };

  const 行们 = 数据.组们.flatMap(({ 比赛, 届次们 }) => [
    建('div', { class: '一级行' },
      建('button', { type: 'button', onclick: () => 打开编辑框(容器, 建, { 标题: `编辑比赛“${比赛.name}”`, 字段们: 数据.字段表.比赛, 原: 比赛,
        提交: 改动 => 提交({ 动作: '编辑比赛', 编号: 比赛.id, 改动, 版本号: 比赛.version }) }) }, '编辑'),
      建('span', { class: '名称' }, 比赛.name),
      建('span', { class: '行尾' },
        建('button', { type: 'button', onclick: () => 打开编辑框(容器, 建, { 标题: `在“${比赛.name}”下新建一届`, 字段们: 数据.字段表.届次, 原: {}, 海报,
          提交: 内容 => 提交({ 动作: '新建届次', 比赛id: 比赛.id, 内容 }) }) }, '新建'),
        建('button', { type: 'button', class: '危险', onclick: () => {
          const 连同 = 比赛.届次们.length ? `和它的 ${比赛.届次们.length} 届` : '';
          if (window.confirm(`删除“${比赛.name}”${连同}？删除后移到回收站，30 天内可以恢复。`)) 出错就提示(() => 提交({ 动作: '删除比赛', 编号: 比赛.id }));
        } }, '删除'))),
    ...届次们.map(届次 => 建('div', { class: '二级行' },
      建('button', { type: 'button', onclick: () => 打开编辑框(容器, 建, { 标题: `编辑“${届次.edition_name}”`, 字段们: 数据.字段表.届次, 原: 届次, 理由: 届次.status_reason, 海报,
        提交: 改动 => 提交({ 动作: '编辑届次', 编号: 届次.id, 改动, 版本号: 届次.version }) }) }, '编辑'),
      建('span', { class: '名称' }, 届次.edition_name),
      建('select', { class: `状态标签 ${届次.status}`, 'aria-label': '状态', title: 届次.status_reason?.join('；') || '',
        onchange: 事件 => 出错就提示(() => 提交({ 动作: '改状态', 编号: 届次.id, 状态: 事件.target.value, 版本号: 届次.version })) },
        数据.状态们.map(名 => 建('option', { value: 名, selected: 名 === 届次.status }, 名))),
      建('span', { class: '行尾' },
        建('button', { type: 'button', class: '危险', onclick: () => {
          if (window.confirm(`删除“${届次.edition_name}”？删除后移到回收站，30 天内可以恢复。`)) 出错就提示(() => 提交({ 动作: '删除届次', 编号: 届次.id }));
        } }, '删除')))),
  ]);
  容器.append(建('div', { class: '两级列表' }, 行们));
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
