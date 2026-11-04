// 对照主库：这条候选在主库里是新比赛、已有比赛的新一届、已有这一届只补来源，还是这一届已经有了、没有新东西。
// 读主库只用 ctx.list、ctx.view（主库的读接口，能看到当晚还没写进去的改动）。搬自 same-name-supplement.mjs 的同名对照和补来源。
// 02 对比去重已经扔掉了认得出的已有比赛，这里是抽取完、名称和届次都准了以后再对照一次，防止漏网的重复入库。
//
//   对照主库(记录, ctx, planned, { 来源们 }) →
//     { kind: '新比赛' }
//     { kind: '新一届', competitionId, 下一个顺序, supersedes: [比它早、还没归档的届次] }
//     { kind: '补来源', competitionId, editionId, 已有来源数, 新来源们 }
//     { kind: '已处理过', editionId, reason }
//   planned：同一晚前面几条已经决定新建或新加届次的比赛（比赛编号 → { 下一个顺序 }），第二条不再新建比赛
//   比赛：名称或别名规范化后一样就算同一个；届次：年份一样、或第几届一样就算同一届
import { 规范名称 } from '../../../common/规范名称.mjs';
import { 网址键 } from '../../../common/网址键.mjs';
import { 拆名称, 比赛编号 } from '../整理字段/index.mjs';

const 年份起点 = y => Number(String(y || '').slice(0, 4)) || null;

export async function 对照主库(记录, ctx, planned, { 来源们 = [] } = {}) {
  const { 名称, 年份, 届次 } = 拆名称(记录.name);
  const 规范 = 规范名称(名称);
  const 比赛 = ctx.list('competition').find(({ data }) => !data.deleted_at && [data.name, ...(data.aliases || [])].some(n => 规范名称(n) === 规范));
  if (!比赛) {
    const id = 比赛编号(记录.name);
    return planned.has(id) ? { kind: '新一届', competitionId: id, 下一个顺序: planned.get(id).下一个顺序, supersedes: [] } : { kind: '新比赛' };
  }
  const 届次们 = ctx.list('edition').filter(({ data }) => data.competition_id === 比赛.key && !data.deleted_at);
  const 同一届 = 届次们.find(({ data }) => (年份 && data.edition_year === 年份) || (届次 && data.edition_ordinal === 届次));
  if (同一届) {
    const 已有 = ctx.list('source').filter(({ data }) => data.edition_id === 同一届.key);
    const 已有键 = new Set(已有.flatMap(({ data }) => [网址键(data.url), 网址键(data.final_url)]).filter(Boolean));
    const 新来源们 = 来源们.filter(s => !已有键.has(网址键(s.url)) && !已有键.has(网址键(s.final_url)));
    if (!新来源们.length) return { kind: '已处理过', editionId: 同一届.key, reason: `库里已有这一届（${同一届.key}），来源也都有了` };
    return { kind: '补来源', competitionId: 比赛.key, editionId: 同一届.key, 已有来源数: 已有.length, 新来源们 };
  }
  const 已排 = planned.get(比赛.key)?.下一个顺序;
  const 下一个顺序 = 已排 || Math.max(0, ...届次们.map(({ data }) => data.ordinal || 0)) + 1;
  const 新年份 = 年份起点(年份);
  const supersedes = 届次们
    .filter(({ data }) => data.status !== '已归档' && 新年份 && 年份起点(data.edition_year) && 年份起点(data.edition_year) < 新年份)
    .map(({ key }) => key);
  return { kind: '新一届', competitionId: 比赛.key, 下一个顺序, supersedes };
}
