// 程序审核的唯一入口：拿记录的字段对照规则。寻找流程（03 筛选、05 审核、06 入库）、维护、后台发布都调这里，
// 规则只有一份（旧注释：发现层和过滤层各写各的规则，正是一批错记录的成因；共用以后改收录范围只需改一处）。
//
//   审核(记录, { 关们, ai, 允许专业待定 }) → { 结果, 停在, 原因, 档, 每关: [{ 关, 结果, 原因, … }] }
//     按调用方给的几关依次查，碰到不是“通过”的就停；结果是停下那一关的结果（不收 / 待定 / 不通过），都过了是“通过”。
//     收录门槛跑过时 档 是“直接收”或“要人看”；给了 ai 时“要人看”的会经 AI 总管再判一次。
//   各关也可以单独调：
//     查标题、查范围、查资料、查门槛、收录门槛、查发布，以及 明显不是大学生、要追溯通知 等判断
//
// 记录用新库的字段名（name、edition_name、organizer、participants、eligibility、format_and_rules、professions、level、
// parent_id、curation_list、recognition、reward_highlights、authority_signals、sources、registration_url、registration_start/end……）。
import { 查标题 } from './标题闸/index.mjs';
import { 查范围 } from './范围闸/index.mjs';
import { 查资料 } from './资料齐不齐/index.mjs';
import { 收录门槛 } from './收录门槛/index.mjs';
import { 查发布 } from './发布门槛/index.mjs';

export { 查标题, 是通知标题, 不是比赛的标题, 要追溯通知, 含通知 } from './标题闸/index.mjs';
export { 查范围, 明显不是大学生, 大学生对象 } from './范围闸/index.mjs';
export { 查资料 } from './资料齐不齐/index.mjs';
export { 查门槛, 收录门槛, 只在本校 } from './收录门槛/index.mjs';
export { 查发布, 报名时间问题, 名称混了年份届次, 有核验过的官方来源 } from './发布门槛/index.mjs';

const 各关 = {
  标题闸: async 记录 => 查标题(记录),
  范围闸: async 记录 => 查范围(记录),
  资料齐不齐: async (记录, 选项) => 查资料(记录, 选项),
  收录门槛: async (记录, 选项) => 收录门槛(记录, 选项),
  发布门槛: async (记录, 选项) => { const r = 查发布(记录, 选项); return { ...r, 原因: r.原因们.join('；') }; },
};
export const 关们 = Object.keys(各关);

export async function 审核(记录, { 关们: 要查, ...选项 } = {}) {
  for (const name of 要查) if (!各关[name]) throw new Error(`程序审核没有这一关：${name}（可用的：${关们.join('、')}）`);
  const 每关 = [];
  let 档 = null;
  for (const name of 要查) {
    const r = await 各关[name](记录, 选项);
    每关.push({ 关: name, ...r });
    if (name === '收录门槛') 档 = r.档;
    if (r.结果 !== '通过') return { 结果: r.结果, 停在: name, 原因: r.原因, 档, 每关 };
  }
  return { 结果: '通过', 停在: null, 原因: '', 档, 每关 };
}
