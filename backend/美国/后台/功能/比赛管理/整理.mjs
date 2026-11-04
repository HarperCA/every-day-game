// 比赛管理 · 整理（纯计算）：一级比赛按名称排，届次挂在下面；按状态筛、按关键词搜；编辑表单的初值和换算。
// 一级比赛不直接给用户看，只用来在后台归类，方便找和管；二级届次才是给用户看的。
// 状态只有三种（2026-10-31 用户定）：已发布、已归档、待人工审核。
export const 筛选顺序 = ['全部', '已归档', '已发布', '待人工审核'];

const 小写 = 文字 => String(文字 ?? '').toLowerCase();
const 名称序 = (a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN');
// 说明里括号、冒号、分号前那段当标签
const 标签 = 说明 => String(说明).split(/[（(：；，]/)[0];

const 提示文字 = {
  新建比赛: r => `已新建比赛“${r.名称}”`,
  新建届次: r => `已新建届次“${r.名称}”，状态是待人工审核`,
  编辑比赛: r => (r.改了.length ? `“${r.名称}”已保存 ${r.改了.length} 处修改` : `“${r.名称}”没有改动`),
  编辑届次: r => (r.改了.length ? `“${r.名称}”已保存 ${r.改了.length} 处修改` : `“${r.名称}”没有改动`),
  改状态: r => `“${r.名称}”已改为${r.状态}`,
  删除比赛: r => `“${r.名称}”连同 ${r.届次} 届已移到回收站，30 天内可以恢复`,
  删除届次: r => `“${r.名称}”已移到回收站，30 天内可以恢复`,
};

export function 整理(原始, { 状态 = '全部', 关键词 = '' } = {}) {
  if (!筛选顺序.includes(状态)) throw new Error(`没有这个状态：${状态}`);
  const 词 = 小写(关键词).trim();
  // 先按关键词：比赛名称或别名对上的，全部届次都算；否则只算届次名对上的那几届
  const 搜到 = [...原始.比赛们].sort(名称序).flatMap(比赛 => {
    if (!词 || [比赛.name, ...(比赛.aliases || [])].some(名 => 小写(名).includes(词))) return [{ 比赛, 届次们: 比赛.届次们 }];
    const 届次们 = 比赛.届次们.filter(e => 小写(e.edition_name).includes(词));
    return 届次们.length ? [{ 比赛, 届次们 }] : [];
  });
  const 全部届次 = 搜到.flatMap(g => g.届次们);
  const 筛选项 = 筛选顺序.map(名 => [名, 名 === '全部' ? 全部届次.length : 全部届次.filter(e => e.status === 名).length]);
  // 再按状态：只留有这种届次的比赛，下面也只列这种届次
  const 组们 = 状态 === '全部' ? 搜到
    : 搜到.map(g => ({ ...g, 届次们: g.届次们.filter(e => e.status === 状态) })).filter(g => g.届次们.length);
  const 加标签 = 字段们 => 字段们.map(f => ({ ...f, 标签: 标签(f.说明) }));
  const 结果 = 原始.结果;
  return {
    组们, 筛选项, 状态, 关键词,
    状态们: 原始.状态们,
    海报规格: 原始.海报规格,
    字段表: { 比赛: 加标签(原始.字段表.比赛), 届次: 加标签(原始.字段表.届次) },
    提示: 结果 ? 提示文字[结果.动作]?.(结果) || '' : '',
  };
}

// 编辑表单里显示的初值：列表用顿号连起来（有可选值的列表给数组，画成多选），对象写成缩进的 JSON，是否给真假，没填的给空
export function 表单初值(字段, 值) {
  if (字段.类型 === '是否') return Boolean(值);
  if (字段.类型 === '列表') return 字段.可选值 ? (值 || []) : (值 || []).join('、');
  if (值 == null) return '';
  if (字段.类型 === '对象') return JSON.stringify(值, null, 2);
  return String(值);
}

const 是空 = 值 => 值 == null || 值 === '' || (Array.isArray(值) && !值.length);

function 换成值(字段, 输入) {
  if (字段.类型 === '是否') return Boolean(输入);
  if (字段.类型 === '列表') {
    const 列表 = Array.isArray(输入) ? 输入 : String(输入 ?? '').split(/[、,，\n]/).map(项 => 项.trim()).filter(Boolean);
    return 列表.length ? 列表 : null;
  }
  const 文字 = String(输入 ?? '').trim();
  if (!文字) return null;
  if (字段.类型 === '整数') {
    if (!/^-?\d+$/.test(文字)) throw new Error(`${字段.标签}要填整数`);
    return Number(文字);
  }
  if (字段.类型 === '对象') {
    try { return JSON.parse(文字); } catch { throw new Error(`${字段.标签}不是合法的 JSON`); }
  }
  return 文字;
}

// 表单填的内容换回字段值，只交回真正变了的（新建时 原 给 {}，空的不交）
export function 表单转改动(字段们, 原, 输入) {
  const 改动 = {};
  for (const 字段 of 字段们) {
    if (!Object.hasOwn(输入, 字段.字段)) continue;
    const 新 = 换成值(字段, 输入[字段.字段]);
    const 旧 = 原[字段.字段];
    if (是空(新) && 是空(旧)) continue;
    if (字段.类型 === '是否' && Boolean(旧) === 新) continue;
    if (JSON.stringify(新) === JSON.stringify(旧 ?? null)) continue;
    改动[字段.字段] = 新;
  }
  return 改动;
}

// 海报（网页里用，纯计算）。规格由 取() 交回的 海报规格 给（640×360、60 KB、比例 1.76～1.79、候选最多 10 张），这里不另写一份数字。
// 从旧后台 apps/admin/src/posterRules.ts 搬来，逻辑不变。
export const 是海报比例 = (规格, 宽, 高) => 宽 > 0 && 高 > 0 && 宽 / 高 >= 规格.比例下限 && 宽 / 高 <= 规格.比例上限;
export const 描述比例 = (宽, 高) => `${宽} × ${高}（宽高比 ${(宽 / 高).toFixed(2)}）`;

// 把一张图压成海报：按质量 0.9、0.85……0.5 依次试，第一张不超过上限的就用；都超给 null。编码(质量) 交回带 size 的 Blob
export async function 压到上限(编码, 最大字节) {
  for (let 质量 = 0.9; 质量 >= 0.5 - 1e-9; 质量 -= 0.05) {
    const 质 = Number(质量.toFixed(2));
    const 图 = await 编码(质);
    if (图.size <= 最大字节) return { 图, 质量: 质 };
  }
  return null;
}

// 加一张候选：同一张图（同一文件名）不重复；最多留 最多 张，超出时去掉最早的
export const 加候选 = (列表, 候选, 最多) => [...(列表 || []).filter(项 => 项.file !== 候选.file), 候选].slice(-最多);
export const 删候选 = (列表, 文件) => (列表 || []).filter(项 => 项.file !== 文件);
