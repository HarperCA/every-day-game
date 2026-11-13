// 比赛管理 · 整理（纯计算）：一级比赛按名称排，届次挂在下面；按状态筛、按关键词搜；编辑表单的初值和换算。
// 一级比赛不直接给用户看，只用来在后台归类，方便找和管；二级届次才是给用户看的。
// 状态只有三种（2026-10-31 用户定）：已发布、已归档、待人工审核。
// 维护时间按最新一条新维护记录着色、点开看详情的换算也在这里（维护标记、维护详情展示，2026-11-08）。
export const 筛选顺序 = ['全部', '已归档', '已发布', '待人工审核'];

const 本周维护筛选顺序 = ['全部维护状态', '本周需要维护', '本周未维护', '本周已维护', '维护中'];

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
  启动AI维护: r => (r.加入 ? `已把 ${r.加入} 个比赛排进 AI 维护，约 2 分钟内开始，每个比赛约几分钟` : '选中的比赛已经在排队了'),
};

// 最新维护时间：按北京时间显示；没维护过写未维护
export function 维护时间文字(时间) {
  const t = Date.parse(时间 ?? '');
  if (!Number.isFinite(t)) return '未维护';
  return new Date(t + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
}

// 搜索记忆（点比赛展开时看，2026-11-07）：按比赛库给的节名顺序列出每节的条目，空的节留着（呈现时写“还没有”）。
// 节名不写死，比赛库加了节（如 2026-11-08 的“维护记录”）跟着显示；记忆里有、节名里还没有的节也列在最后，不丢
export function 搜索记忆展示(记忆, 节名) {
  if (!记忆) return { 有: false, 说明: '还没有搜索记忆：新维护第一次查这个比赛时会建一份', 节们: [] };
  const 谁 = 记忆.updated_by ? ` · ${记忆.updated_by}` : '';
  const 全部节 = [...节名, ...Object.keys(记忆.节 || {}).filter(名 => !节名.includes(名))];
  return {
    有: true,
    说明: `最后修改 ${维护时间文字(记忆.updated_at)}${谁} · 第 ${记忆.version} 版`,
    节们: 全部节.map(名 => ({ 名, 条目们: 记忆.节?.[名] || [] })),
  };
}

// 维护时间那一行（2026-11-08 用户定）：仍只写“最新维护 时间”，不写成功失败；最新一条新维护记录 成功 是 true 显示绿色、false 显示红色，
// 这两种才能点开看详情。没有新维护记录、旧记录没写 成功、从没维护过的照旧（灰色、不能点）。
export function 维护标记(比赛) {
  const 时间 = 维护时间文字(比赛?.last_maintained_at);
  const 成功 = 比赛?.最新新维护?.成功;
  const 有结论 = 时间 !== '未维护' && typeof 成功 === 'boolean';
  return { 文字: `最新维护 ${时间}`, 颜色: 有结论 ? (成功 ? '成功' : '失败') : '', 可展开: 有结论 };
}

const 文字 = 值 => (值 == null ? '' : String(值));
const 对象们 = 列表 => (Array.isArray(列表) ? 列表.filter(项 => 项 && typeof 项 === 'object') : []);

// 改动里的值（2026-11-08）：空的（null、空文字、空列表、空对象）写“（空）”，是否写是/否，列表用顿号连，对象写成一行 JSON，其余原样
const 是空值 = 值 => 值 == null || (typeof 值 === 'string' && !值.trim()) || (Array.isArray(值) && !值.length)
  || (typeof 值 === 'object' && !Array.isArray(值) && !Object.keys(值).length);
const 一项文字 = 值 => (值 && typeof 值 === 'object' ? JSON.stringify(值) : String(值));
function 值文字(值) {
  if (是空值(值)) return '（空）';
  if (typeof 值 === 'boolean') return 值 ? '是' : '否';
  if (Array.isArray(值)) return 值.map(一项文字).join('、');
  return 一项文字(值);
}

// 改动按届次分组（按第一次出现的顺序）：届次写名称，取不到写编号；字段写届次表说明的短名（同编辑表单的标签），取不到写字段名
function 改动分组(改动, 届次名, 字段说明) {
  const 组们 = new Map();
  for (const 项 of 对象们(改动)) {
    const 届次 = 文字(项.届次);
    if (!组们.has(届次)) 组们.set(届次, { 届次: 文字(届次名?.[届次]) || 届次 || '（没写届次）', 条们: [] });
    const 字段 = 文字(项.字段);
    组们.get(届次).条们.push({ 字段: (字段说明?.[字段] && 标签(字段说明[字段])) || 字段 || '（没写字段）', 改前: 值文字(项.改前), 改后: 值文字(项.改后), 网址: 文字(项.网址) });
  }
  return [...组们.values()];
}

// 点开维护时间看的详情：摘要（旧记录没有就用结果）、北京时间、结果（和摘要一样就不重复）、原因、入库各条、改动（按届次分组）、每一步过程。
// 届次名、字段说明是 读维护详情 一起交回的（{ 届次编号: 名称 }、{ 字段: 说明 }），没给就显示编号、字段名
export function 维护详情展示(详情, { 届次名 = {}, 字段说明 = {} } = {}) {
  if (!详情) return { 有: false, 说明: '这个比赛还没有新维护记录' };
  const 摘要 = 文字(详情.摘要) || 文字(详情.结果);
  const 结果 = 文字(详情.结果);
  const 改动 = 改动分组(详情.改动, 届次名, 字段说明);
  return {
    有: true,
    颜色: typeof 详情.成功 === 'boolean' ? (详情.成功 ? '成功' : '失败') : '',
    摘要,
    时间: 维护时间文字(详情.时间),
    结果: 结果 && 结果 !== 摘要 ? 结果 : '',
    原因: 文字(详情.原因),
    入库: 对象们(详情.入库).map(项 => ({ 网址: 文字(项.网址), 状态: 文字(项.状态), 原因: 文字(项.原因) })),
    过程: 对象们(详情.过程).map(项 => ({ 步骤: 文字(项.步骤), 说明: 文字(项.说明) })),
    改动, 改动数: 改动.reduce((和, 组) => 和 + 组.条们.length, 0),
  };
}

export function 维护状态(编号, 队列) {
  if (队列?.正在 === 编号) return '维护中';
  return 队列?.排队?.includes(编号) ? '排队中' : '';
}

export function 整理(原始, { 状态 = '全部', 关键词 = '', 本周维护 = '全部维护状态' } = {}) {
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
  const 按状态 = 状态 === '全部' ? 搜到
    : 搜到.map(g => ({ ...g, 届次们: g.届次们.filter(e => e.status === 状态) })).filter(g => g.届次们.length);
  const 统计 = new Map([['全部维护状态', 按状态.length], ['本周需要维护', 0]]);
  for (const { 比赛 } of 按状态) {
    const 名 = 比赛.本周维护状态;
    if (!名) continue;
    统计.set(名, (统计.get(名) || 0) + 1);
    统计.set('本周需要维护', 统计.get('本周需要维护') + 1);
  }
  const 本周筛选项 = 本周维护筛选顺序.map(名 => [名, 统计.get(名) || 0]);
  const 组们 = 按状态.filter(({ 比赛 }) => {
    if (本周维护 === '全部维护状态') return true;
    if (本周维护 === '本周需要维护') return Boolean(比赛.本周维护状态);
    return 比赛.本周维护状态 === 本周维护;
  });
  const 加标签 = 字段们 => 字段们.map(f => ({ ...f, 标签: 标签(f.说明) }));
  const 结果 = 原始.结果;
  return {
    组们, 筛选项, 状态, 关键词, 本周维护, 本周筛选项,
    状态们: 原始.状态们,
    海报规格: 原始.海报规格,
    AI维护: 原始.AI维护,
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
