// 对照主库：这条候选在主库里是新比赛、已有比赛的新一届、已有这一届只补来源，还是这一届已经有了、没有新东西。
// 读主库只用 ctx.list、ctx.view（主库的读接口，能看到当晚还没写进去的改动）。搬自 same-name-supplement.mjs 的同名对照和补来源。
// 02 对比去重已经扔掉了能确认的旧届和同届，这里是抽取完、名称和届次都准了以后再对照一次，防止漏网的重复入库。
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
//   比赛：比名称或别名和赛道；届次：双方都有届数时比届数，其他情况比年份。
//         比较前规范化（2026-11-08）：年份区间取前一个年份（“2025—2026”和“2025”算同一年），第几届换成数（第十届=第10届）
import { 比赛身份, 比届次, 库中届次, 拆名称 } from '../../../common/届次与赛道.mjs';
import { 网址键 } from '../../../common/网址键.mjs';
import { 比赛编号 as 算比赛编号 } from '../整理字段/index.mjs';

export async function 对照主库(记录, ctx, planned, { 来源们 = [], 比赛编号 = null, 届次编号 = null, 本次来源 = new Map(), 仅新届次 = false } = {}) {
  if (届次编号) {
    const 届 = 指定的届次(ctx, 届次编号, 比赛编号);
    return 对来源(ctx, 本次来源, 来源们, 届.data.competition_id, 届次编号, false);
  }
  const 身份 = 比赛身份(记录.name, 记录.track_name);
  const 同届 = data => 比届次(身份, 库中届次(data)) === 0;
  const 已有届次 = ctx.list('edition').filter(({ data }) => !data.deleted_at);
  const 比赛 = 比赛编号 ? 指定的比赛(ctx, 比赛编号) : 按身份找(ctx, 身份, 已有届次);
  const 比赛id = 比赛?.key ?? 算比赛编号(记录.name, 记录.track_name);
  const 计划 = planned.get(比赛id);

  // 同一次入库前面几条刚决定新建的届次：同一届就补来源，不再建
  const 刚建的 = (计划?.届次们 || []).find(同届);
  if (刚建的) return 对来源(ctx, 本次来源, 来源们, 比赛id, 刚建的.id, true);

  const { 年份 } = 拆名称(记录.name);
  const 预计编号 = 年份 && 'edition-' + 比赛id.replace(/^event-/, '') + '-' + 年份.replace(/[^0-9]+/g, '-');
  const 已用届次编号 = 预计编号 && (ctx.view('edition', 预计编号) || 计划?.届次们?.some(row => row.id === 预计编号))
    ? { 已用届次编号: new Set([预计编号]) } : {};
  if (!比赛) return 计划 ? { kind: '新一届', competitionId: 比赛id, 下一个顺序: 计划.下一个顺序, supersedes: [], ...已用届次编号 } : { kind: '新比赛' };
  const 届次们 = 已有届次.filter(({ data }) => data.competition_id === 比赛.key &&
    (比赛编号 || 库中届次(data, 比赛.data.name).赛道键 === 身份.赛道键));
  const 同一届 = 届次们.find(({ data }) => 同届(data));
  if (同一届) return 对来源(ctx, 本次来源, 来源们, 比赛.key, 同一届.key, false);
  const 较新 = 仅新届次 && [...届次们, ...(计划?.届次们 || []).map(data => ({ key: data.id, data }))]
    .find(({ data }) => data.status !== '待人工审核' && 比届次(身份, 库中届次(data)) === -1);
  if (较新) return { kind: '已处理过', competitionId: 比赛.key, editionId: 较新.key, reason: '该赛道已收录较新的届次' };
  const 下一个顺序 = 计划?.下一个顺序 || Math.max(0, ...届次们.map(({ data }) => data.ordinal || 0)) + 1;
  const supersedes = 届次们
    .filter(({ data }) => data.status === '已发布' && 比届次(身份, 库中届次(data)) === 1)
    .map(({ key }) => key);
  return { kind: '新一届', competitionId: 比赛.key, 下一个顺序, supersedes, ...已用届次编号 };
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

function 按身份找(ctx, 身份, 届次们) {
  return ctx.list('competition').find(({ key, data }) => {
    if (data.deleted_at) return false;
    const 届次身份 = 届次们.filter(row => row.data.competition_id === key).map(row => 库中届次(row.data, data.name));
    const 同名 = [data.name, ...(data.aliases || [])].map(name => 比赛身份(name)).filter(x => x.名称键 === 身份.名称键);
    if (!同名.length) return false;
    if (同名.some(x => x.赛道键 && x.赛道键 === 身份.赛道键)) return true;
    const 赛道们 = new Set(届次身份.map(x => x.赛道键));
    if (赛道们.size) return 赛道们.size === 1 && 赛道们.has(身份.赛道键) && 同名.some(x => !x.赛道键);
    return 同名.some(x => x.赛道键 === 身份.赛道键);
  }) || null;
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
