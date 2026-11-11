// 搜索记忆（search_memory）：每个比赛一份 Markdown，新维护搜索前先读、查完写回（2026-11-07 用户定）。只管存取和格式，不做业务判断。
//
// 格式固定：总标题“# 搜索记忆”，下面七节按顺序，每节若干条“- ”开头的条目，可以没有条目：
//   官方域名 / 通知列表页 / 往年通知标题格式 / 成功过的搜索词（年份、届次留空，如 {年份}、{届次}）/ 往年真实发布日期 / 教训（最多 3 条）
//   / 维护记录（2026-11-08 加：每次维护成功失败都写一行，最新在前，最多 5 条，如“- 2026-11-08 成功：没有变化（指纹和上次一样，跳过）”）
// 2026-11-08 以前写的记忆没有“维护记录”这一节：解析时当空的，下次改节（生成）时补上。别的节一节都不能少。
//
//   节名、最多教训、最多维护记录、每条维护记录最长
//   解析(md) → { 官方域名: [条目], … }        格式不对报“校验不通过”
//   生成(节) → md                            没给的节当空的；不认识的节、教训超过 3 条、维护记录超过 5 条、条目里有换行报“校验不通过”
//                                            维护记录是程序写的日志，宽松处理：空白和换行并成一个空格，超过 200 字截断；
//                                            整份超过 8000 字（表的上限）时从最旧的维护记录删起，删光还超就照旧交给写入时报太长
//   初始(比赛) → md                          比赛库里有官网的写上域名（注明还没核实），其余留空
//   读(db, 比赛编号) → { 比赛, version, 内容, 节, created_at, updated_at, updated_by } 或 null
//   写(db, 比赛编号, md, { 版本, 操作人 }) → { id, version }    第一次写不带版本号，之后带读到的版本号
//   改节(db, 比赛编号, { 节: [条目] }, { 版本, 操作人 }) → { id, version }   只换给出的节；还没有记忆的从初始开始
//   补齐(db, { 试跑, 操作人 }) → { 新建: [比赛编号], 已有: 条数 }   没有记忆的比赛（含回收站里的）写上初始的，已有的不动
import { DbError } from '../../../共用/db/index.mjs';
import 搜索记忆表 from '../描述/表/比赛数据/搜索记忆.mjs';

export const 节名 = ['官方域名', '通知列表页', '往年通知标题格式', '成功过的搜索词', '往年真实发布日期', '教训', '维护记录'];
export const 最多教训 = 3;
export const 最多维护记录 = 5;
export const 每条维护记录最长 = 200;
const 可以没有 = ['维护记录'];  // 旧记忆里没有的节
const 全文最长 = 搜索记忆表.字段.content.最长;
const 总标题 = '# 搜索记忆';
const 表 = 'search_memory';

const 不通过 = (message, id = null) => new DbError('校验不通过', `搜索记忆${message}`, { table: 表, id, problems: [{ field: 'content', rule: '格式', message }] });

function 查教训(节) {
  if ((节.教训 || []).length > 最多教训) throw 不通过(`的教训最多 ${最多教训} 条，现在 ${节.教训.length} 条`);
  if ((节.维护记录 || []).length > 最多维护记录) throw 不通过(`的维护记录最多 ${最多维护记录} 条，现在 ${节.维护记录.length} 条`);
}

// 一条维护记录：空白和换行并成一个空格，太长截断（按字算，和表的“最长”一样）
function 整理维护记录(条) {
  const 字 = [...String(条 ?? '').replace(/\s+/g, ' ').trim()];
  return 字.length > 每条维护记录最长 ? `${字.slice(0, 每条维护记录最长 - 1).join('')}…` : 字.join('');
}

export function 解析(md) {
  if (typeof md !== 'string') throw 不通过('不是文字');
  const 节 = {};
  let 当前 = null;
  let 有总标题 = false;
  for (const 原行 of md.replace(/\r\n/g, '\n').split('\n')) {
    const 行 = 原行.trim();
    if (!行) continue;
    if (!有总标题) {
      if (行 !== 总标题) throw 不通过(`第一行要是“${总标题}”`);
      有总标题 = true;
      continue;
    }
    if (行.startsWith('## ')) {
      const 名 = 行.slice(3).trim();
      const 该是 = 节名[Object.keys(节).length];
      if (名 !== 该是) throw 不通过(该是 ? `的第 ${Object.keys(节).length + 1} 节要是“${该是}”，写的是“${名}”` : `多了不认识的节“${名}”`);
      节[名] = [];
      当前 = 名;
      continue;
    }
    if (行.startsWith('- ') && 当前 && 行.slice(2).trim()) {
      节[当前].push(行.slice(2).trim());
      continue;
    }
    throw 不通过(`里有一行不是“## 节名”也不是“- 条目”：${行.slice(0, 50)}`);
  }
  if (!有总标题) throw 不通过(`第一行要是“${总标题}”`);
  const 少了 = 节名.filter(名 => !(名 in 节) && !可以没有.includes(名));
  if (少了.length) throw 不通过(`少了：${少了.join('、')}`);
  for (const 名 of 可以没有) 节[名] ??= [];
  查教训(节);
  return 节;
}

export function 生成(节 = {}) {
  const 不认识 = Object.keys(节).filter(名 => !节名.includes(名));
  if (不认识.length) throw 不通过(`没有这几节：${不认识.join('、')}`);
  查教训(节);
  const 条目 = Object.fromEntries(节名.map(名 => {
    const 条目们 = (节[名] || []).map(条 => (名 === '维护记录' ? 整理维护记录(条) : String(条).trim()));
    if (条目们.some(条 => !条 || /[\r\n]/.test(条))) throw 不通过(`“${名}”里有空条目或条目里有换行`);
    return [名, 条目们];
  }));
  const 拼 = () => `${[总标题, ...节名.map(名 => (条目[名].length ? `## ${名}\n\n${条目[名].map(条 => `- ${条}`).join('\n')}` : `## ${名}`))].join('\n\n')}\n`;
  let md = 拼();
  // 太长时先删最旧的维护记录（最新在前，删最后一条）
  while ([...md].length > 全文最长 && 条目.维护记录.length) {
    条目.维护记录.pop();
    md = 拼();
  }
  return md;
}

export function 初始(比赛 = {}) {
  let 域名 = null;
  try {
    const 网址 = new URL(比赛.website);
    if (网址.protocol === 'http:' || 网址.protocol === 'https:') 域名 = 网址.hostname;
  } catch { /* 没填或不是网址：留空 */ }
  return 生成(域名 ? { 官方域名: [`${域名}（比赛库官网字段，还没核实）`] } : {});
}

export function 读(db, 比赛编号) {
  const 行 = db.get(表, 比赛编号);
  if (!行) return null;
  const { content, created_at, updated_at, updated_by } = 行.data;
  return { 比赛: 比赛编号, version: 行.version, 内容: content, 节: 解析(content), created_at, updated_at, updated_by };
}

export function 写(db, 比赛编号, md, { 版本 = null, 操作人 = null } = {}) {
  解析(md);
  return db.transaction(tx => {
    if (版本 == null) {
      if (tx.get(表, 比赛编号)) throw new DbError('请求有误', `比赛 ${比赛编号} 已有搜索记忆，改要带读到的版本号`, { table: 表, id: 比赛编号 });
      const 回 = tx.insert(表, 比赛编号, { content: md, updated_by: 操作人 });
      return { id: 回.id, version: 回.version };
    }
    const 回 = tx.update(表, 比赛编号, { content: md, updated_by: 操作人 }, 版本);
    return { id: 回.id, version: 回.version };
  });
}

export function 改节(db, 比赛编号, 改动 = {}, { 版本 = null, 操作人 = null } = {}) {
  const 不认识 = Object.keys(改动).filter(名 => !节名.includes(名));
  if (不认识.length) throw 不通过(`没有这几节：${不认识.join('、')}`, 比赛编号);
  return db.transaction(tx => {
    const 现在 = 读(tx, 比赛编号);
    let 原节 = 现在?.节;
    if (!原节) {
      const 比赛 = tx.get('competition', 比赛编号, { 包括已删除: true });
      if (!比赛) throw new DbError('找不到', `没有比赛 ${比赛编号}`, { table: 'competition', id: 比赛编号 });
      原节 = 解析(初始(比赛.data));
    }
    return 写(tx, 比赛编号, 生成({ ...原节, ...改动 }), { 版本, 操作人 });
  });
}

export function 补齐(db, { 试跑 = false, 操作人 = '补齐搜索记忆' } = {}) {
  const 已有 = new Set(db.find(表).map(r => r.id));
  const 缺的 = db.find('competition', {}, { orderBy: 'id', 包括已删除: true }).filter(c => !已有.has(c.id));
  if (!试跑) db.transaction(tx => { for (const c of 缺的) tx.insert(表, c.id, { content: 初始(c), updated_by: 操作人 }); });
  return { 新建: 缺的.map(c => c.id), 已有: 已有.size };
}
