// 整理字段：按比赛库的字段规则（backend/美国/db/描述/），把 05 核验改正后的记录、核验过的官方来源整理成比赛、届次、来源三张表的内容。
// 只填有出处的字段，空的填 null（比赛库不收空字符串）；参赛形式、队伍人数分档、报名方式、费用分档没填时由比赛库补默认值“暂未明确”“暂未公布”。
// 名称、届次的拆法搬自 adminData/editionTitle.js；编号格式沿用现有的 event-xxx、edition-xxx-年份、source-xxx-年份-序号（2026-11-01 定）。
//
//   整理字段({ 记录, 来源们, 对照, 发现 }) → { competition: { id, data } | null, edition: { id, data } | null, sources: [{ id, data }] }
//     对照：新比赛 → 新建比赛（级别先填“其他/未明确”，抽取里没有级别，不靠主办方名字猜）；新一届 → 挂在已有比赛下，顺序接着排；
//           补来源 → 只整理来源，编号接着这一届已有的排
//   拆名称(名称) → { 名称, 年份, 届次 }       名称里的年份、第几届拆出来，原文留在届次名称
//   年份起点(年份)、届次数(届次) → 认届次时比的数（对照主库用：年份区间取前一年，第十届=第10届）
//   比赛编号(名称) → 'event-' + 规范名称算出的 8 位短码，同名同号
//   已截止(届次, now) → 报名截止已过（只写日期的按北京时间这一天结束算）
//   届次内容(记录) → 届次表里来自通知的那些字段（名称、年份、届次、主办方、参赛对象……报名时间、回报），新一届和“更新已有”的比对共用
//   比对届次(旧届次, 新内容, 选项) → [{ 字段, 改前, 改后 }]   见 比对届次.mjs
import crypto from 'node:crypto';
import { 规范名称 } from '../../../common/规范名称.mjs';

import { 拆名称, 比赛身份 } from '../../../common/届次与赛道.mjs';
export { 拆名称, 年份起点, 届次数 } from '../../../common/届次与赛道.mjs';

const 回报可选 = ['保研考研加分', '实习或直通面试', '就业绿色通道', '创业扶持', '国际交流', '证书荣誉', '实物奖品', '现金奖金'];
const 届次字段 = ['organizer', 'participants', 'eligibility', 'format_and_rules', 'team_size', 'registration_method', 'registration_url', 'fees', 'registration_start', 'registration_end'];

const 空就null = v => (v === undefined || v === null || (typeof v === 'string' && !v.trim()) ? null : v);

export function 比赛编号(name, track) {
  const 身份 = 比赛身份(name, track);
  const key = 身份.赛道键 ? [身份.名称键, 身份.赛道键].join('|') : 规范名称(拆名称(name).名称);
  return 'event-' + crypto.createHash('sha1').update(key).digest('hex').slice(0, 8);
}

// 报名截止的时刻：只写日期的按北京时间这一天结束
function 截止时刻(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const t = /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T23:59:59.999+08:00`) : Date.parse(value);
  return Number.isFinite(t) ? t : null;
}
export const 已截止 = (届次, now) => { const t = 截止时刻(届次?.registration_end); return t !== null && t < now.getTime(); };

const 来源行 = (届次编号, 已有, 来源们) => 来源们.map((s, i) => ({ id: `source-${届次编号.replace(/^edition-/, '')}-${已有 + i + 1}`, data: { edition_id: 届次编号, ...s } }));

// 届次表里来自通知的字段（不含编号、所属比赛、顺序、状态、发现经过这些）
export function 届次内容(记录) {
  const { 年份: y, 届次: o } = 拆名称(记录.name);
  const data = { edition_name: String(记录.name || '').trim(), edition_year: y, edition_ordinal: o };
  const { 赛道 } = 比赛身份(记录.name, 记录.track_name);
  if (赛道) data.track_name = 赛道;
  for (const f of 届次字段) data[f] = 空就null(记录[f]);
  data.pending_announcement = Boolean(记录.pending_announcement);
  data.reward_highlights = (记录.reward_highlights || []).filter(x => 回报可选.includes(x));
  return data;
}

export function 整理字段({ 记录, 来源们 = [], 对照, 发现 = null }) {
  if (对照.kind === '补来源') return { competition: null, edition: null, sources: 来源行(对照.editionId, 对照.已有来源数 || 0, 来源们) };
  const { 名称, 年份: y } = 拆名称(记录.name);
  const 身份 = 比赛身份(记录.name, 记录.track_name);
  const competition = 对照.kind === '新比赛'
    ? { id: 比赛编号(记录.name, 记录.track_name), data: { name: 身份.赛道 ? 身份.名称.slice(0, Math.max(1, 198 - 身份.赛道.length)) + '（' + 身份.赛道 + '）' : 名称, level: '其他/未明确', organizer: 空就null(记录.organizer), professions: 记录.professions || [] } }
    : null;
  const 比赛id = competition?.id || 对照.competitionId;
  const ordinal = 对照.kind === '新比赛' ? 1 : 对照.下一个顺序;
  const 届次编号 = `edition-${比赛id.replace(/^event-/, '')}-${y ? y.replace(/[^0-9]+/g, '-') : `n${ordinal}`}`;
  const id = 对照.已用届次编号?.has(届次编号) ? 届次编号 + '-n' + ordinal : 届次编号;
  const data = { competition_id: 比赛id, ordinal, ...届次内容(记录) };
  data.discovery = 发现;
  return { competition, edition: { id, data }, sources: 来源行(id, 0, 来源们) };
}

export { 比对届次 } from './比对届次.mjs';
