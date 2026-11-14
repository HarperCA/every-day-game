// 比对届次：入库时打开“更新已有”（新维护核对已有比赛用，2026-11-08 用户定“读全文看看现在写的是否正确，不正确就进行更改”），
// 候选对上库里已有的一届时，拿这条通知整理出的届次内容（整理字段 的 届次内容）和库里那一届逐项比，找出要改的字段。
// 每晚流程不开“更新已有”，对上已有届次时不比字段，所以这里的规则只管维护。
//
//   比对届次(旧届次, 新内容, { 比赛, 通知网址, 待公布写明, 只补空 }) → [{ 字段, 改前, 改后 }]
//     只补空（2026-11-13 用户定，高校转发用）：确定事实也只在库里空着时补——高校转发不是官方来源，不拿它覆盖已有值
//
// 2026-11-09 用户定“只改确定的事实”（美国试跑把 event-cmp002 的赛制改成只剩“（一）主体赛事”、参赛资格改窄；
// 本地实测赛制从四类作品的完整说明变成一句话、报名截止从“12-04 23:59”变成“12-04”、主办方改成“参赛指南”）：
//   确定事实（事实字段）：报名开始、报名截止、比赛开始、比赛结束、报名网址。新值非空、规范化以后和旧值不同就改。
//     日期时间：新旧是北京时间同一天、新值只有日期而旧值带具体时间 → 不改（不把精确时间改粗）；
//               新值带时间、旧值只有日期 → 改（变精确）；同一天两个不同时间、或不同日期 → 改。
//   其余参与比对的字段（赛制和规则、参赛对象、参赛资格、报名方式、主办方、团队人数、费用、奖励亮点、待公布，以及年份、届次）：
//     只在库里原来是空（null、空串、只有空白、空列表）时补上，原来有值就不动。
//     主办方届次没填时看比赛的：比赛有主办方就算不空，不补（学生看到的就是比赛的主办方）。
//     年份、届次（edition_year、edition_ordinal）本来就是这个规则：认届次用的，改了以后下次认不出这一届（2026-11-08 代码审查）。
//     费用（fees，费用原文）2026-11-13 用户定从确定事实挪到只补空：两次实测都把费用改差（完整说明被换成截断的“…其中：”、丢了缴费截止）。
//     fee_type（费用分档）现在的抽取不交，不比。
//   人工改过的字段（manual_fields）照同样规则，不做特殊处理。
// 规范化：文字去首尾空白、连续空白算一个；日期 2026-11-01、2026年11月1日 和北京时间 2026-11-01 零点算同一个；
//         网址按 网址键 比（不分 http/https、www、结尾斜杠）。
// 通知网址：这条候选自己的网址。报名网址就是它时，多半是抽取没抽到、拿通知网址顶上的（common/candidate.mjs），不拿来改。
// 待公布写明：记录里明确写了 pending_announcement（true/false）才比这一项；现在的抽取不交这一项，所以一般不比。
// 只比来自通知的字段；编号、所属比赛、顺序、届次全称、状态、版本、时间、发现经过、海报、推荐这些不比（见 06 README）。
// 比赛开始、比赛结束：届次内容（整理字段）现在不交（04 不抽这两项），列在这里是以后交了就按事实规则比。
import { 网址键 } from '../../../common/网址键.mjs';

export const 比对字段 = ['edition_year', 'edition_ordinal', 'organizer', 'participants', 'eligibility', 'format_and_rules', 'team_size',
  'registration_method', 'registration_url', 'fees', 'registration_start', 'registration_end', 'competition_start', 'competition_end',
  'pending_announcement', 'reward_highlights'];

const 日期字段 = new Set(['registration_start', 'registration_end', 'competition_start', 'competition_end']);
// 确定事实：不同就改；其余只补空（费用 2026-11-13 起只补空）
export const 事实字段 = new Set([...日期字段, 'registration_url']);

const 文字 = v => (v === undefined || v === null ? null : String(v).replace(/　/g, ' ').replace(/\s+/g, ' ').trim() || null);
const 补零 = n => String(n).padStart(2, '0');

// 日期信息：{ 日: 北京时间的 YYYY-MM-DD, 带时间, 键 }；认不出的交回 { 日: null, 带时间: false, 键: 原文 }
//   只写日期的（2026-12-04、2026/12/4、2026年12月4日）：带时间 false，键是日期
//   带时间的：按北京时间换算；正好是北京时间零点的算只写日期；其余键是毫秒数
function 日期信息(v) {
  const s = 文字(v);
  if (!s) return null;
  const m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(s);
  if (m) { const 日 = `${m[1]}-${补零(m[2])}-${补零(m[3])}`; return { 日, 带时间: false, 键: 日 }; }
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return { 日: null, 带时间: false, 键: s };
  const 北京 = new Date(t + 8 * 3600 * 1000).toISOString();
  const 日 = 北京.slice(0, 10);
  return 北京.endsWith('T00:00:00.000Z') ? { 日, 带时间: false, 键: 日 } : { 日, 带时间: true, 键: String(t) };
}

function 键(字段, v) {
  if (字段 === 'reward_highlights') return Array.isArray(v) && v.length ? JSON.stringify([...new Set(v)].sort()) : null;
  if (字段 === 'pending_announcement') return typeof v === 'boolean' ? String(v) : null;
  if (日期字段.has(字段)) return 日期信息(v)?.键 ?? null;
  if (字段 === 'registration_url') return 网址键(v) || 文字(v);
  if (字段 === 'edition_year') return 文字(v)?.replace(/\s*[-—–~～至]\s*/g, '—') ?? null;
  return 文字(v);
}

// 写进库的新值：文字只去首尾空白（不动中间的换行），列表去重
function 新值(字段, v) {
  if (字段 === 'reward_highlights') return [...new Set(v)];
  return typeof v === 'string' ? v.trim() : v;
}

// 日期：同一天、新值只有日期、旧值带具体时间 → 不改粗
function 改粗了(旧值, 新值) {
  const 旧 = 日期信息(旧值);
  const 新 = 日期信息(新值);
  return Boolean(旧?.带时间 && 新 && !新.带时间 && 新.日 && 新.日 === 旧.日);
}

export function 比对届次(旧 = {}, 新 = {}, { 比赛 = null, 通知网址 = '', 待公布写明 = false, 只补空 = false } = {}) {
  const 改动 = [];
  for (const 字段 of 比对字段) {
    if (字段 === 'pending_announcement' && !待公布写明) continue;
    const 新键 = 键(字段, 新[字段]);
    if (新键 === null) continue;
    if (字段 === 'registration_url' && 通知网址 && 网址键(新[字段]) && 网址键(新[字段]) === 网址键(通知网址)) continue;
    const 旧值 = 字段 === 'organizer' ? (文字(旧.organizer) ?? 比赛?.organizer ?? null) : 旧[字段];
    const 旧键 = 键(字段, 旧值);
    if ((只补空 || !事实字段.has(字段)) && 旧键 !== null) continue; // 只补空：库里原来有值就不动
    if (旧键 === 新键) continue;
    if (日期字段.has(字段) && 改粗了(旧值, 新[字段])) continue;
    改动.push({ 字段, 改前: 旧[字段] ?? null, 改后: 新值(字段, 新[字段]) });
  }
  return 改动;
}
