// 发布门槛：发布、归档上线前最后查一遍。只看字段，不调接口。给 06 入库和后台发布用。
// 搬自 adminData/publicCache.js 的 requirePublishGate、requireArchivedGate、hasReviewedOfficialSource，
// registrationSchedule.js 的 registrationScheduleIssues，editionTitle.js 的 titleHasEditionTokens（字段改成新库的名字）。
// 旧门槛里的“系统校验、人工审核已通过”两条，新结构里状态只有三种（2026-10-31 定），不再查。
//
//   查发布(记录, { 归档 }) → { 结果: '通过' | '不通过', 原因们: [..] }   列出所有没过的地方
//   归档：报不上名了，只查标题、范围、名称，报名网址、来源不再要求（旧注释：只是留着给学生看下一届大概什么时候）
//   2026-11-12 用户定放宽两条：
//     官方来源核过一次就算（有核对时间就行），不要求发布前 24 小时内复核；
//     缺报名网址时，有核验过的官方来源就不拦。门槛只判断，不改记录；发布、写入的地方用 报名网址顶上(记录) 把报名网址填成那条官方通知页。
//   报名网址顶上(记录) → 记录里的报名网址；没有就是核验过的官方来源的网址（主办方通知 organizer_notice 优先）；都没有给 ''
//   2026-11-12 用户定（找新一届）：发现新一届就发布，追不到官方通知的用高校转发发布、标明来源。
//     高校转发来源：source_type 'school_repost'、is_official 为假、validity_status 'valid'、http(s) 网址（属于这一届）。
//     没有核验过的官方来源、但有高校转发来源的届次：“没有核验过的官方来源”“没有报名网址”两条放行，标题、范围、名称、报名时间照查；
//     报名网址顶上不拿转发页（转发页不是报名入口）。
//   有高校转发来源(记录) → 是否
//   信息来源(记录) → 'official'（有核验过的官方来源）| 'school_repost'（没有官方的、有高校转发的）| null（都没有）
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
const 是核验过的官方来源 = 记录 => s => Boolean(s?.id && s.source_type
    && !['discovery_notice', 'university_notice', 'search_candidate'].includes(s.source_type)
    && s.is_official === true && s.validity_status === 'valid' && /^https?:\/\//i.test(s.url || '')
    && (!s.edition_id || !记录.id || s.edition_id === 记录.id)
    && Number.isFinite(Date.parse(s.last_verified_at || ''))
    && ['title', 'content_summary', 'evidence_excerpt', 'review_reason'].every(f => typeof s[f] === 'string' && s[f].trim())
    && Array.isArray(s.supports_fields) && s.supports_fields.some(f => typeof f === 'string' && f.trim()));

export function 有核验过的官方来源(记录 = {}) {
  return (记录.sources || []).some(是核验过的官方来源(记录));
}

export const 高校转发类型 = 'school_repost';
const 是高校转发来源 = 记录 => s => Boolean(s?.source_type === 高校转发类型 && s.validity_status === 'valid' && /^https?:\/\//i.test(s.url || '')
    && (!s.edition_id || !记录.id || s.edition_id === 记录.id));

export function 有高校转发来源(记录 = {}) {
  return (记录.sources || []).some(是高校转发来源(记录));
}

export function 信息来源(记录 = {}) {
  if (有核验过的官方来源(记录)) return 'official';
  return 有高校转发来源(记录) ? 高校转发类型 : null;
}

const 是网址 = 值 => /^https?:\/\//i.test(值 || '');

export function 报名网址顶上(记录 = {}) {
  if (是网址(记录.registration_url)) return 记录.registration_url;
  const 核过的 = (记录.sources || []).filter(是核验过的官方来源(记录));
  return (核过的.find(s => s.source_type === 'organizer_notice') || 核过的[0])?.url || '';
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
    // 高校转发（2026-11-12 用户定）：没有官方来源时，有效的高校转发来源也放行这两条
    const 有官方来源 = 有核验过的官方来源(记录) || 有高校转发来源(记录);
    // 缺报名网址：有核验过的官方来源（主办方通知页）就不拦，发布时拿它顶上（2026-11-12）；高校转发的不顶，报名网址留空
    if (!是网址(记录.registration_url) && !有官方来源) 原因们.push('没有报名网址');
    if (!有官方来源) 原因们.push('没有核验过的官方来源');
  }
  return { 结果: 原因们.length ? '不通过' : '通过', 原因们 };
}
