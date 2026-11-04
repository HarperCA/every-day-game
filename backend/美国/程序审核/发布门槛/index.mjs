// 发布门槛：发布、归档上线前最后查一遍。只看字段，不调接口。给 06 入库和后台发布用。
// 搬自 adminData/publicCache.js 的 requirePublishGate、requireArchivedGate、hasReviewedOfficialSource，
// registrationSchedule.js 的 registrationScheduleIssues，editionTitle.js 的 titleHasEditionTokens（字段改成新库的名字）。
// 旧门槛里的“系统校验、人工审核已通过”两条，新结构里状态只有三种（2026-10-31 定），不再查。
//
//   查发布(记录, { 归档 }) → { 结果: '通过' | '不通过', 原因们: [..] }   列出所有没过的地方
//   归档：报不上名了，只查标题、范围、名称，报名网址、来源不再要求（旧注释：只是留着给学生看下一届大概什么时候）
import { 查标题, 要追溯通知 } from '../标题闸/index.mjs';
import { 查范围 } from '../范围闸/index.mjs';

const 年份 = /(?<!\d)((?:19|20)\d{2}(?:\s*[-—–~～至]\s*(?:19|20)\d{2})?)(?:年(?:度)?|赛季)?(?!\d)/;
const 届次 = /第[零〇一二三四五六七八九十百千万两\d]+届/;
// 名称只保留比赛本体，年份、届次是当届属性，要单独填
export const 名称混了年份届次 = name => 年份.test(String(name || '')) || 届次.test(String(name || ''));

// 报名时间：只到日期的按北京时间这一天的开头、结尾算
function 时刻(value, 边界) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = value.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return NaN;
  if (new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString().slice(0, 10) !== date) return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(`${value}T${边界 === '截止' ? '23:59:59.999' : '00:00:00'}+08:00`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return NaN;
  return Date.parse(value);
}

export function 报名时间问题(记录 = {}) {
  const start = 时刻(记录.registration_start, '开始');
  const end = 时刻(记录.registration_end, '截止');
  const 问题 = [];
  if (start !== null && !Number.isFinite(start)) 问题.push('报名开始时间格式无效');
  if (end !== null && !Number.isFinite(end)) 问题.push('报名截止时间格式无效');
  if (Number.isFinite(start) && Number.isFinite(end) && start > end) 问题.push('报名开始时间晚于报名截止时间');
  if (start === null && end === null && !记录.pending_announcement) 问题.push('报名起止时间均缺失，请核实或说明尚未公布');
  return 问题;
}

// 核验过的官方来源：不是发现线索、学校通知、搜索候选；是官方的、有效的，核对时间、标题、摘要、原文、核对理由、支持哪些字段都写了
export function 有核验过的官方来源(记录 = {}) {
  return (记录.sources || []).some(s => s?.id && s.source_type
    && !['discovery_notice', 'university_notice', 'search_candidate'].includes(s.source_type)
    && s.is_official === true && s.validity_status === 'valid' && /^https?:\/\//i.test(s.url || '')
    && (!s.edition_id || !记录.id || s.edition_id === 记录.id)
    && Number.isFinite(Date.parse(s.last_verified_at || ''))
    && ['title', 'content_summary', 'evidence_excerpt', 'review_reason'].every(f => typeof s[f] === 'string' && s[f].trim())
    && Array.isArray(s.supports_fields) && s.supports_fields.some(f => typeof f === 'string' && f.trim()));
}

export function 查发布(记录 = {}, { 归档 = false } = {}) {
  const 原因们 = [];
  const 标题 = 查标题(记录);
  if (标题.结果 !== '通过') 原因们.push(标题.原因);
  else if (要追溯通知(记录)) 原因们.push('通知、栏目或目录标题，要先追溯比赛本身');
  const 范围 = 查范围(记录);
  if (范围.结果 !== '通过' && 标题.结果 === '通过') 原因们.push(`范围没通过：${范围.原因}`);
  if (名称混了年份届次(记录.name)) 原因们.push('名称里混了年份或届次，要单独填');
  if (!归档) {
    原因们.push(...报名时间问题(记录));
    if (!/^https?:\/\//i.test(记录.registration_url || '')) 原因们.push('没有报名网址');
    if (!有核验过的官方来源(记录)) 原因们.push('没有核验过的官方来源');
  }
  return { 结果: 原因们.length ? '不通过' : '通过', 原因们 };
}
