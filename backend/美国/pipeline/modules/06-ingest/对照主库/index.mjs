// 对照主库：这条候选在主库里是新比赛、已有比赛的新一届、已有这一届只补来源，还是这一届已经有了、没有新东西。
// 读主库只用 ctx.list、ctx.view（主库的读接口，能看到当晚还没写进去的改动）。搬自 same-name-supplement.mjs 的同名对照和补来源。
// 02 对比去重已经扔掉了认得出的已有比赛，这里是抽取完、名称和届次都准了以后再对照一次，防止漏网的重复入库。
//
//   对照主库(记录, ctx, planned, { 来源们, 比赛编号, 届次编号, 本次来源 }) →
//     { kind: '新比赛' }
//     { kind: '新一届', competitionId, 下一个顺序, supersedes: [比它早、已发布的届次] }   待人工审核的不跟着归档：归档会公开，没审过的不能这样出去（2026-11-04）
//     { kind: '补来源', competitionId, editionId, 已有来源数, 新来源们, 本次新建? }
//     { kind: '已处理过', competitionId, editionId, reason, 本次新建? }
//   planned：同一次入库前面几条已经决定新建或新加届次的比赛（比赛编号 → { 下一个顺序, 届次们: [{ id, edition_year, edition_ordinal }] }），
//            第二条不再新建比赛；指向前面刚决定新建的同一届时，算补来源（本次新建: true），不再建一次（2026-11-08，中车杯同一届建了两次）
//   本次来源：同一次入库前面几条已经补进某一届的来源（届次编号 → { 键们: Set(网址键), 数 }），编号接着排、同一网址不再补
//   比赛编号：调用方已经知道是哪个比赛（新维护维护的就是这个比赛，2026-11-08）。给了就只在这个比赛下认届次，
//            名字写法不同也不另建比赛（中联杯）；主库里没有这个比赛就报错
//   届次编号：调用方已经知道是哪一届（2026-11-08 代码审查）。给了就直接用这一届（补来源 / 已处理过），不按名字认；
//            这一届主库里没有（不存在或已删除）、或不属于给的比赛编号就报错（入库总管把这条标失败）
//   比赛：名称或别名规范化后一样就算同一个；届次：年份一样、或第几届一样就算同一届。
//         比较前规范化（2026-11-08）：年份区间取前一个年份（“2025—2026”和“2025”算同一年），第几届换成数（第十届=第10届）
import { 规范名称 } from '../../../common/规范名称.mjs';
import { 网址键 } from '../../../common/网址键.mjs';
import { 拆名称, 比赛编号 as 算比赛编号, 年份起点, 届次数 } from '../整理字段/index.mjs';

export async function 对照主库(记录, ctx, planned, { 来源们 = [], 比赛编号 = null, 届次编号 = null, 本次来源 = new Map() } = {}) {
  if (届次编号) {
    const 届 = 指定的届次(ctx, 届次编号, 比赛编号);
    return 对来源(ctx, 本次来源, 来源们, 届.data.competition_id, 届次编号, false);
  }
  const { 名称, 年份, 届次 } = 拆名称(记录.name);
  const 年 = 年份起点(年份);
  const 第几 = 届次数(届次);
  const 同届 = data => Boolean((年 && 年份起点(data.edition_year) === 年) || (第几 && 届次数(data.edition_ordinal) === 第几));
  const 比赛 = 比赛编号 ? 指定的比赛(ctx, 比赛编号) : 按名字找(ctx, 名称);
  const 比赛id = 比赛?.key ?? 算比赛编号(记录.name);
  const 计划 = planned.get(比赛id);

  // 同一次入库前面几条刚决定新建的届次：同一届就补来源，不再建
  const 刚建的 = (计划?.届次们 || []).find(同届);
  if (刚建的) return 对来源(ctx, 本次来源, 来源们, 比赛id, 刚建的.id, true);

  if (!比赛) return 计划 ? { kind: '新一届', competitionId: 比赛id, 下一个顺序: 计划.下一个顺序, supersedes: [] } : { kind: '新比赛' };
  const 届次们 = ctx.list('edition').filter(({ data }) => data.competition_id === 比赛.key && !data.deleted_at);
  const 同一届 = 届次们.find(({ data }) => 同届(data));
  if (同一届) return 对来源(ctx, 本次来源, 来源们, 比赛.key, 同一届.key, false);
  const 下一个顺序 = 计划?.下一个顺序 || Math.max(0, ...届次们.map(({ data }) => data.ordinal || 0)) + 1;
  const supersedes = 届次们
    .filter(({ data }) => data.status === '已发布' && 年 && 年份起点(data.edition_year) && 年份起点(data.edition_year) < 年)
    .map(({ key }) => key);
  return { kind: '新一届', competitionId: 比赛.key, 下一个顺序, supersedes };
}

function 指定的比赛(ctx, id) {
  const row = ctx.view('competition', id);
  if (!row || row.data?.deleted_at) throw new Error(`指定的比赛 ${id} 主库里没有（不存在或已删除），不按名字另建`);
  return { key: id, ...row };
}

function 指定的届次(ctx, id, 比赛编号) {
  const row = ctx.view('edition', id);
  if (!row || row.data?.deleted_at) throw new Error(`指定的届次 ${id} 主库里没有（不存在或已删除），不按名字另认`);
  if (比赛编号 && row.data.competition_id !== 比赛编号) throw new Error(`指定的届次 ${id} 不属于比赛 ${比赛编号}（它属于 ${row.data.competition_id}）`);
  return row;
}

function 按名字找(ctx, 名称) {
  const 规范 = 规范名称(名称);
  return ctx.list('competition').find(({ data }) => !data.deleted_at && [data.name, ...(data.aliases || [])].some(n => 规范名称(n) === 规范)) || null;
}

// 已有这一届（库里的，或同一次前面刚决定新建的）：比来源，有新的就补来源，没有就是已处理过
function 对来源(ctx, 本次来源, 来源们, competitionId, editionId, 本次新建) {
  const 库里 = ctx.list('source').filter(({ data }) => data.edition_id === editionId);
  const 本次 = 本次来源.get(editionId) || { 键们: new Set(), 数: 0 };
  const 已有键 = new Set([...库里.flatMap(({ data }) => [网址键(data.url), 网址键(data.final_url)]), ...本次.键们].filter(Boolean));
  const 新来源们 = 来源们.filter(s => !已有键.has(网址键(s.url)) && !已有键.has(网址键(s.final_url)));
  const 标 = 本次新建 ? { 本次新建: true } : {};
  if (!新来源们.length) {
    const 说明 = 本次新建 ? `这次入库前面一条刚建了这一届（${editionId}），来源也都有了` : `库里已有这一届（${editionId}），来源也都有了`;
    return { kind: '已处理过', competitionId, editionId, reason: 说明, ...标 };
  }
  return { kind: '补来源', competitionId, editionId, 已有来源数: 库里.length + 本次.数, 新来源们, ...标 };
}
