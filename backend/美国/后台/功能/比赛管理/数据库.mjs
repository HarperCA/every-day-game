// 比赛管理 · 取数据和动作（美国服务器上跑）：先做动作（没给就只列出），再交回全部没删的比赛（各带届次）。
// 读写只调比赛库的函数（比赛.*、届次.*）；版本号、manual_fields、操作日志由比赛库那边管。
//
//   取({ 动作, ... }, { db, 操作人, now })
//     新建比赛  { 内容 }                    左上角“新建”
//     新建届次  { 比赛id, 内容 }             一级比赛行右边的“新建”
//     编辑比赛  { 编号, 改动, 版本号 }        行左边的“编辑”，点确定才保存
//     编辑届次  { 编号, 改动, 版本号 }
//     改状态    { 编号, 状态, 版本号 }        列表里直接改：已发布、已归档、待人工审核
//     删除比赛  { 编号, 不再收录, 理由 }      连同它的届次一起进回收站；不再收录的记进不收录名单
//     删除届次  { 编号 }                    只删这一届，进回收站
//     启动AI维护 { 编号们 }                   多选的比赛排进 AI 维护队列（2026-11-06 用户定），定时器每 2 分钟看一眼，最优先
//     存图片    { 图片, 种类 }               编辑框里选了图：只存进图片总库（种类 海报 或 候选），交回 { 结果: 文件名和宽高 }，不写比赛库、不交回列表；
//                                           海报、候选图随“确定”一起作为 poster、poster_candidates 保存，保存前核对图片总库里有这些图
//     读搜索记忆 { 编号 }                   点比赛名称展开时取这个比赛的搜索记忆（2026-11-07），交回 { 结果: { 编号, 节名, 记忆 } }，
//                                           记忆是比赛库 搜索记忆.读 的结果，还没有的给 null；只读，不交回列表
//     读维护详情 { 编号 }                   点维护时间展开时取这个比赛最新一条新维护记录（audit_log action '新维护'，2026-11-08），
//                                           交回 { 结果: { 动作, 编号, 详情: { 时间, 成功, 摘要, 结果, 原因, 入库, 过程, 改动 }, 届次名, 字段说明 } }，没有记录的 详情 给 null；只读，不交回列表。
//                                           改动 [{ 届次, 网址, 字段, 改前, 改后 }] 是维护核对后改了的字段（旧记录给 []）；届次名 { 届次编号: 届次全称 }、
//                                           字段说明 { 字段: 届次表描述的说明 } 只给改动里用到的，没有改动时都是 {}
//   交回 { 比赛们, 字段表, 状态们, 海报规格, AI维护, 结果 }：比赛和届次只带编号、版本号、状态和给用户看的字段，比赛另带最新维护时间
//   和 最新新维护 { 成功, 摘要, 时间 }（最新一条新维护记录的简要，给维护时间着色；没有记录给 null，没写成功的 成功 给 null）；字段表给编辑表单用（海报单独一栏，不在里面）。
//   环境里的 图片目录 不给时用图片总库的默认位置。
import { TABLES, 比赛, 届次, 图片总库, 维护队列, 搜索记忆, 下次检查 } from '../../../db/index.mjs';

const 一天 = 86400000;
const 北京时差 = 8 * 3600000;
function 本周范围(now) {
  const 北京时间 = new Date(now.getTime() + 北京时差);
  const 今天零点 = Date.UTC(北京时间.getUTCFullYear(), 北京时间.getUTCMonth(), 北京时间.getUTCDate());
  const 周一 = 今天零点 - (北京时间.getUTCDay() + 6) % 7 * 一天 - 北京时差;
  return { 周一, 下周一: 周一 + 7 * 一天 };
}

const 海报字段 = ['poster', 'poster_candidates'];

// 设海报、留候选图之前核对图片总库里真有这些图
function 核对图片(改动, 图片目录) {
  const 文件们 = [改动?.poster?.file, ...(Array.isArray(改动?.poster_candidates) ? 改动.poster_candidates.map(项 => 项?.file) : [])].filter(Boolean);
  for (const 文件 of 文件们) if (!图片总库.有(文件, { 目录: 图片目录 })) throw new Error(`图片总库里没有这张图：${文件}，请重新选图`);
}

const 动作们 = {
  启动AI维护: (db, { 编号们 }, 选项) => {
    if (!Array.isArray(编号们) || !编号们.length) throw new Error('至少选一个比赛');
    return 维护队列.加入(db, 编号们, 选项);
  },
  新建比赛: (db, { 内容 }, 选项) => { const 回 = 比赛.新建(db, 内容, 选项); return { 编号: 回.id, 名称: 回.data.name }; },
  新建届次: (db, { 比赛id, 内容 }, 选项) => { 核对图片(内容, 选项.图片目录); const 回 = 届次.新建(db, 比赛id, 内容, 选项); return { 编号: 回.id, 名称: 回.data.edition_name }; },
  编辑比赛: (db, { 编号, 改动, 版本号 }, 选项) => { const 回 = 比赛.编辑(db, 编号, 改动, 版本号, 选项); return { 编号, 名称: 回.data.name, 改了: 回.改了 }; },
  编辑届次: (db, { 编号, 改动, 版本号 }, 选项) => { 核对图片(改动, 选项.图片目录); const 回 = 届次.编辑(db, 编号, 改动, 版本号, 选项); return { 编号, 名称: 回.data.edition_name, 改了: 回.改了 }; },
  改状态: (db, { 编号, 状态, 版本号 }, 选项) => { const 回 = 届次.改状态(db, 编号, 状态, 版本号, 选项); return { 编号, 名称: 回.data.edition_name, 状态 }; },
  删除比赛: (db, { 编号, 不再收录, 理由 }, 选项) => {
    const 名称 = db.get('competition', 编号)?.data.name;
    return { 编号, 名称, ...比赛.删除(db, 编号, { ...选项, 不再收录, 理由 }) };
  },
  删除届次: (db, { 编号 }, 选项) => {
    const 名称 = db.get('edition', 编号)?.data.edition_name;
    return { 编号, 名称, ...届次.删除(db, 编号, 选项) };
  },
};

const 挑出 = (记录, 字段们) => Object.fromEntries(字段们.map(字段 => [字段, 记录[字段] ?? null]));
const 字段说明 = (表名, 字段们) => 字段们.map(字段 => {
  const { 说明, 类型, 可选值, 必填 } = TABLES[表名].字段[字段];
  return { 字段, 说明, 类型, ...(可选值 ? { 可选值 } : {}), 必填 };
});

// ---- 新维护的结果（2026-11-08 用户定）----
// 新维护每维护一个比赛在 audit_log 写一条 action '新维护'、record_id 比赛编号，detail { 成功, 摘要, 结果, 原因, 入库, 过程, 改动 }（旧记录可能没有 成功、摘要、改动）。
// 同一个事务里把比赛的 last_maintained_at 写成这条记录的 created_at（db/新维护/维护一个.mjs 的 收尾）。
const 新维护 = '新维护';
const 一段 = 400;   // IN 里一次最多放这么多个值，免得超过 SQLite 的参数上限
const 分段 = 列表 => Array.from({ length: Math.ceil(列表.length / 一段) }, (_, i) => 列表.slice(i * 一段, (i + 1) * 一段));
const 时刻 = 时间 => Date.parse(时间 ?? '');
// 新到旧：created_at 晚的新；同一时刻按编号大的新（和操作记录的 ['-created_at', '-id'] 一致）
const 比较新旧 = (a, b) => 时刻(a.created_at) - 时刻(b.created_at) || String(a.id).localeCompare(String(b.id));

// 每个比赛最新一条新维护记录（比赛编号 → audit_log 那一行）。七百多个比赛不一个个查，最多查两轮：
//   1. 按各比赛的 last_maintained_at 这些时刻一次查出 action 是新维护的记录——正常情况下每个比赛正好找到最新那一条；
//   2. 维护过但最新的没对上这个时刻的（比如后来别的维护又改了 last_maintained_at），再按比赛编号（有索引）查它们全部的新维护记录取最新。
// 前提：新维护的记录不会比比赛的 last_maintained_at 还晚（两者在同一个事务里写）。
function 最新新维护们(db, 比赛们) {
  const 最新 = new Map();
  const 收 = 行们 => {
    for (const 行 of 行们) {
      const 旧 = 最新.get(行.record_id);
      if (!旧 || 比较新旧(行, 旧) > 0) 最新.set(行.record_id, 行);
    }
  };
  const 维护过 = 比赛们.filter(c => c.last_maintained_at);
  for (const 段 of 分段([...new Set(维护过.map(c => c.last_maintained_at))])) 收(db.find('audit_log', { action: 新维护, created_at: { in: 段 } }));
  const 没对上 = 维护过.filter(c => 时刻(最新.get(c.id)?.created_at) !== 时刻(c.last_maintained_at)).map(c => c.id);
  for (const 段 of 分段(没对上)) 收(db.find('audit_log', { action: 新维护, record_id: { in: 段 } }));
  return 最新;
}

// 列表里每个比赛只带 { 成功, 摘要, 时间 }（给维护时间着色）；没写 成功 的给 null
const 简要 = 行 => (行 ? { 成功: typeof 行.detail?.成功 === 'boolean' ? 行.detail.成功 : null, 摘要: 行.detail?.摘要 ?? '', 时间: 行.created_at } : null);

// 点开维护时间时取：这个比赛最新一条新维护记录的全部内容；没有记录给 null，旧记录缺的字段补成空。
// 改动（2026-11-08 用户又定：维护核对已有比赛的字段，不对就改）每条 { 届次, 网址, 字段, 改前, 改后 }，不是对象的丢掉，旧记录没有给 []
const 改动项们 = 列表 => (Array.isArray(列表) ? 列表.filter(项 => 项 && typeof 项 === 'object' && !Array.isArray(项)) : [])
  .map(项 => ({ 届次: 项.届次 ?? null, 网址: 项.网址 ?? '', 字段: 项.字段 ?? null, 改前: 项.改前 ?? null, 改后: 项.改后 ?? null }));
function 维护详情(db, 编号) {
  const [行] = db.find('audit_log', { action: 新维护, record_id: 编号 }, { orderBy: ['-created_at', '-id'], limit: 1 });
  if (!行) return null;
  const d = 行.detail || {};
  return {
    时间: 行.created_at, 成功: typeof d.成功 === 'boolean' ? d.成功 : null, 摘要: d.摘要 ?? '', 结果: d.结果 ?? '', 原因: d.原因 ?? '',
    入库: Array.isArray(d.入库) ? d.入库 : [], 过程: Array.isArray(d.过程) ? d.过程 : [], 改动: 改动项们(d.改动),
  };
}

// 改动里届次编号 → 届次名称、字段名 → 届次表描述里的说明（短名由 整理.mjs 的 维护详情展示 截）。
// 只在有改动时查一次这个比赛的届次（含回收站里的，删了的也能显示名称）；对不上的不给，界面就显示编号、字段名。
function 改动的名称(db, 编号, 改动) {
  if (!改动.length) return { 届次名: {}, 字段说明: {} };
  const 用到的届次 = new Set(改动.map(项 => 项.届次));
  const 届次名 = Object.fromEntries(db.find('edition', { competition_id: 编号 }, { 包括已删除: true })
    .filter(e => 用到的届次.has(e.id) && e.edition_name).map(e => [e.id, e.edition_name]));
  const 字段们 = TABLES.edition.字段;
  const 字段说明 = Object.fromEntries([...new Set(改动.map(项 => 项.字段))].filter(字段 => Object.hasOwn(字段们, 字段 ?? '')).map(字段 => [字段, 字段们[字段].说明]));
  return { 届次名, 字段说明 };
}

function 列出(db, 当前时间, 队列) {
  const 比赛们 = 比赛.全部连届次(db);
  const 最新 = 最新新维护们(db, 比赛们);
  const { 周一, 下周一 } = 本周范围(当前时间);
  const 正在 = new Set([队列.正在].flat().filter(Boolean));
  const 排队 = new Set(队列.排队);
  function 本周状态(比赛) {
    if (正在.has(比赛.id)) return '维护中';
    const 上次 = Date.parse(比赛.last_maintained_at ?? '');
    if (上次 >= 周一 && 上次 <= 当前时间.getTime()) return '本周已维护';
    if (排队.has(比赛.id)) return '本周未维护';
    const { 下次检查: 到期时间 } = 下次检查(比赛, 比赛.届次们, 当前时间);
    return 到期时间 === null || Date.parse(到期时间) < 下周一 ? '本周未维护' : null;
  }
  return 比赛们.map(c => ({
    本周维护状态: 本周状态(c),
    id: c.id, version: c.version, last_maintained_at: c.last_maintained_at ?? null, 最新新维护: 简要(最新.get(c.id)), ...挑出(c, 比赛.可改字段),
    届次们: c.届次们.map(e => ({ id: e.id, version: e.version, status: e.status, status_reason: e.status_reason ?? [], ...挑出(e, 届次.可改字段) })),
  }));
}

// 浏览器传来的图片：data:image/...;base64, 开头或纯 base64
function 图片内容(图片) {
  const 纯 = String(图片 || '').replace(/^data:image\/[a-z]+;base64,/i, '');
  if (!纯 || !/^[A-Za-z0-9+/=]+$/.test(纯)) throw new Error('读不出这张图（不是 base64）');
  return Buffer.from(纯, 'base64');
}

export async function 取({ 动作, ...参数 } = {}, { db, 操作人 = '管理员', now = () => new Date(), 图片目录 }) {
  if (动作 === '存图片') {
    const { 文件, 宽, 高, 字节, 是海报比例 } = 图片总库.存(图片内容(参数.图片), 参数.种类, { 目录: 图片目录 });
    return { 结果: { 动作, 文件, 宽, 高, 字节, 是海报比例 } };
  }
  if (动作 === '读搜索记忆') {
    if (!db.get('competition', 参数.编号)) throw new Error(`没有这个比赛：${参数.编号}`);
    return { 结果: { 动作, 编号: 参数.编号, 节名: 搜索记忆.节名, 记忆: 搜索记忆.读(db, 参数.编号) } };
  }
  if (动作 === '读维护详情') {
    if (!db.get('competition', 参数.编号)) throw new Error(`没有这个比赛：${参数.编号}`);
    const 详情 = 维护详情(db, 参数.编号);
    return { 结果: { 动作, 编号: 参数.编号, 详情, ...改动的名称(db, 参数.编号, 详情?.改动 ?? []) } };
  }
  const 当前时间 = now();
  let 结果 = null;
  if (动作) {
    if (!Object.hasOwn(动作们, 动作)) throw new Error(`不认识的动作：${动作}`);
    结果 = { 动作, ...动作们[动作](db, 参数, { 操作人, at: 当前时间.toISOString(), 图片目录 }) };
  }
  const 队列 = 维护队列.读(db);
  return {
    比赛们: 列出(db, 当前时间, 队列),
    字段表: { 比赛: 字段说明('competition', 比赛.可改字段), 届次: 字段说明('edition', 届次.可改字段.filter(字段 => !海报字段.includes(字段))) },
    状态们: 届次.状态们,
    海报规格: { ...图片总库.海报规格, ...图片总库.海报比例范围 },
    AI维护: 队列,
    结果,
  };
}
