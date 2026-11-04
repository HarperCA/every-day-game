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
//     存图片    { 图片, 种类 }               编辑框里选了图：只存进图片总库（种类 海报 或 候选），交回 { 结果: 文件名和宽高 }，不写比赛库、不交回列表；
//                                           海报、候选图随“确定”一起作为 poster、poster_candidates 保存，保存前核对图片总库里有这些图
//   交回 { 比赛们, 字段表, 状态们, 海报规格, 结果 }：比赛和届次只带编号、版本号、状态和给用户看的字段；字段表给编辑表单用（海报单独一栏，不在里面）。
//   环境里的 图片目录 不给时用图片总库的默认位置。
import { TABLES, 比赛, 届次, 图片总库 } from '../../../db/index.mjs';

const 海报字段 = ['poster', 'poster_candidates'];

// 设海报、留候选图之前核对图片总库里真有这些图
function 核对图片(改动, 图片目录) {
  const 文件们 = [改动?.poster?.file, ...(Array.isArray(改动?.poster_candidates) ? 改动.poster_candidates.map(项 => 项?.file) : [])].filter(Boolean);
  for (const 文件 of 文件们) if (!图片总库.有(文件, { 目录: 图片目录 })) throw new Error(`图片总库里没有这张图：${文件}，请重新选图`);
}

const 动作们 = {
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

function 列出(db) {
  return 比赛.全部连届次(db).map(c => ({
    id: c.id, version: c.version, ...挑出(c, 比赛.可改字段),
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
  let 结果 = null;
  if (动作) {
    if (!Object.hasOwn(动作们, 动作)) throw new Error(`不认识的动作：${动作}`);
    结果 = { 动作, ...动作们[动作](db, 参数, { 操作人, at: now().toISOString(), 图片目录 }) };
  }
  return {
    比赛们: 列出(db),
    字段表: { 比赛: 字段说明('competition', 比赛.可改字段), 届次: 字段说明('edition', 届次.可改字段.filter(字段 => !海报字段.includes(字段))) },
    状态们: 届次.状态们,
    海报规格: { ...图片总库.海报规格, ...图片总库.海报比例范围 },
    结果,
  };
}
