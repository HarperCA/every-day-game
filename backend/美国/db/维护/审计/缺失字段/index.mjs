// 缺失字段：该有的字段空着（2026-11-03 用户定，库里已有的空字段也交给维护）。只读比赛库，交回发现的问题；补由查找交给 Codex 补字段（美国/补字段/）。
//   看哪些届次：每个比赛的最新一届，和所有已发布的届次。更早的已归档届次不看：补它们要花 Codex 的轮数，对学生用处不大。
//   看哪些字段：和补字段的字段表一致——时间（报名开始、截止，比赛开始、结束）、参赛对象、资格依据、赛制、报名入口、报名方式、费用、奖励；
//     主办方、专业分类记在比赛上（届次自己写了主办方就不算缺）。参赛对象写明大学生的，不再另要资格依据（同 程序审核 的资料齐不齐）。
//     时间标了待公布也照样列出：官方后来公布了，要回头查。
//   一条记录缺的字段合成一个问题（字段们），一次交给 Codex，不按字段一个个查。
//
//   run(ctx) → { problems: [问题] }，问题的写法见 ../../README.md；另带 字段们（缺的字段名列表）
// 规矩：只用 ctx 给的东西，不 import 别的检查项。
import { 大学生对象 } from '../../../../程序审核/index.mjs';

export const meta = { title: '缺失字段' };

const 届次字段 = {
  registration_start: '报名开始', registration_end: '报名截止', competition_start: '比赛开始', competition_end: '比赛结束',
  participants: '参赛对象', eligibility: '大学生参赛资格依据', format_and_rules: '赛制与规则',
  registration_url: '报名入口', registration_method: '报名方式', fees: '费用', rewards: '奖励',
};
const 比赛字段 = { organizer: '主办方', professions: '专业分类' };
const 空 = 值 => 值 == null || (Array.isArray(值) ? !值.length : /^\s*(暂未明确|暂未公布|待确认|待核实|未知|暂无)?\s*$/.test(String(值)));

function 问题(table, key, 缺, 名们) {
  const 字段 = 缺.map(k => 名们[k]).join('、');
  return { table, key, 字段, 字段们: 缺, 类型: '缺失', 现在的值: null, 依据: `空着：${字段}`, 把握: '有把握' };
}

export async function run(ctx) {
  const 比赛们 = ctx.范围?.比赛编号
    ? [ctx.db.get('competition', ctx.范围.比赛编号)].filter(Boolean).map(r => ({ id: ctx.范围.比赛编号, ...r.data }))
    : ctx.db.find('competition', {}, { orderBy: 'id' });
  const problems = [];
  for (const 比赛 of 比赛们) {
    const 届次们 = ctx.db.find('edition', { competition_id: 比赛.id }, { orderBy: '-ordinal' });
    const 要看 = 届次们.filter((e, i) => i === 0 || e.status === '已发布');
    const 比赛缺 = Object.keys(比赛字段).filter(k => 空(比赛[k]) && !(k === 'organizer' && 要看.some(e => !空(e.organizer))));
    if (比赛缺.length) problems.push(问题('competition', 比赛.id, 比赛缺, 比赛字段));
    for (const 届 of 要看) {
      const 缺 = Object.keys(届次字段).filter(k => 空(届[k]) && !(k === 'eligibility' && 大学生对象.test(String(届.participants || ''))));
      if (缺.length) problems.push(问题('edition', 届.id, 缺, 届次字段));
    }
  }
  return { problems };
}
