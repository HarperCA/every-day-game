// 整理字段：按比赛库的字段规则（backend/美国/db/描述/），把 05 核验改正后的记录、核验过的官方来源整理成比赛、届次、来源三张表的内容。
// 只填有出处的字段，空的填 null（比赛库不收空字符串）；参赛形式、队伍人数分档、报名方式、费用分档没填时由比赛库补默认值“暂未明确”“暂未公布”。
// 名称、届次的拆法搬自 adminData/editionTitle.js；编号格式沿用现有的 event-xxx、edition-xxx-年份、source-xxx-年份-序号（2026-11-01 定）。
//
//   整理字段({ 记录, 来源们, 对照, 发现 }) → { competition: { id, data } | null, edition: { id, data } | null, sources: [{ id, data }] }
//     对照：新比赛 → 新建比赛（级别先填“其他/未明确”，抽取里没有级别，不靠主办方名字猜）；新一届 → 挂在已有比赛下，顺序接着排；
//           补来源 → 只整理来源，编号接着这一届已有的排
//   拆名称(名称) → { 名称, 年份, 届次 }       名称里的年份、第几届拆出来，原文留在届次名称
//   比赛编号(名称) → 'event-' + 规范名称算出的 8 位短码，同名同号
//   已截止(届次, now) → 报名截止已过（只写日期的按北京时间这一天结束算）
import crypto from 'node:crypto';
import { 规范名称 } from '../../../common/规范名称.mjs';

const 年份 = /(?<!\d)((?:19|20)\d{2}(?:\s*[-—–~～至]\s*(?:19|20)\d{2})?)(?:年(?:度)?|赛季)?(?!\d)/;
const 届次 = /第[零〇一二三四五六七八九十百千万两\d]+届/;
const 回报可选 = ['保研考研加分', '实习或直通面试', '就业绿色通道', '创业扶持', '国际交流', '证书荣誉', '实物奖品', '现金奖金'];
const 届次字段 = ['organizer', 'participants', 'eligibility', 'format_and_rules', 'team_size', 'registration_method', 'registration_url', 'fees', 'registration_start', 'registration_end'];

const 空就null = v => (v === undefined || v === null || (typeof v === 'string' && !v.trim()) ? null : v);

export function 拆名称(value) {
  const text = String(value || '').trim();
  const y = 年份.exec(text);
  const o = 届次.exec(text);
  const 名称 = text.replace(new RegExp(年份.source, 'g'), '').replace(new RegExp(届次.source, 'g'), '')
    .replace(/\(\s*\)|（\s*）|【\s*】|\[\s*\]/g, '').replace(/\s{2,}/g, ' ')
    .replace(/^[\s,，、:：|｜丨·•\-—–]+|[\s,，、:：|｜丨·•\-—–]+$/g, '').trim();
  return { 名称: 名称 || text, 年份: y ? y[1].replace(/\s*[-–~～至]\s*/g, '—') : null, 届次: o ? o[0] : null };
}

export const 比赛编号 = name => `event-${crypto.createHash('sha1').update(规范名称(拆名称(name).名称)).digest('hex').slice(0, 8)}`;

// 报名截止的时刻：只写日期的按北京时间这一天结束
function 截止时刻(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const t = /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T23:59:59.999+08:00`) : Date.parse(value);
  return Number.isFinite(t) ? t : null;
}
export const 已截止 = (届次, now) => { const t = 截止时刻(届次?.registration_end); return t !== null && t < now.getTime(); };

const 来源行 = (届次编号, 已有, 来源们) => 来源们.map((s, i) => ({ id: `source-${届次编号.replace(/^edition-/, '')}-${已有 + i + 1}`, data: { edition_id: 届次编号, ...s } }));

export function 整理字段({ 记录, 来源们 = [], 对照, 发现 = null }) {
  if (对照.kind === '补来源') return { competition: null, edition: null, sources: 来源行(对照.editionId, 对照.已有来源数 || 0, 来源们) };
  const { 名称, 年份: y, 届次: o } = 拆名称(记录.name);
  const competition = 对照.kind === '新比赛'
    ? { id: 比赛编号(记录.name), data: { name: 名称, level: '其他/未明确', organizer: 空就null(记录.organizer), professions: 记录.professions || [] } }
    : null;
  const 比赛id = competition?.id || 对照.competitionId;
  const ordinal = 对照.kind === '新比赛' ? 1 : 对照.下一个顺序;
  const 届次编号 = `edition-${比赛id.replace(/^event-/, '')}-${y ? y.replace(/[^0-9]+/g, '-') : `n${ordinal}`}`;
  const data = { competition_id: 比赛id, ordinal, edition_name: String(记录.name || '').trim(), edition_year: y, edition_ordinal: o };
  for (const f of 届次字段) data[f] = 空就null(记录[f]);
  data.pending_announcement = Boolean(记录.pending_announcement);
  data.reward_highlights = (记录.reward_highlights || []).filter(x => 回报可选.includes(x));
  data.discovery = 发现;
  return { competition, edition: { id: 届次编号, data }, sources: 来源行(届次编号, 0, 来源们) };
}
