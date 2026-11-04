// 用户输入：把小程序首页带来的请求整理成统一的条件，再按面板条件筛比赛。参数名沿用现在的小程序（不用改小程序就能接）。
// 从旧代码 publicData/listOrder.js（stringList、分页）和 publicQuery.js（passesPublicFilters、daysUntilNextRegistration）搬来，逻辑不变。
//
//   整理输入(请求) → 条件 { 关键词, 专业们, 省份, 列表分组, 面板, 几天内能报, 收藏, 提醒, 页, 每页 }
//     只收认得的参数，超范围的收回到范围里；收藏、提醒编号只在没登录时用（登录了从副数据库读）
//   面板筛选(item, 条件, now) → 是否留下：级别、参赛形式、队伍人数、费用、报名方式、报名状态、专业、地区、举办情况、距报名多久
//     已停办的默认不显示（明确筛“举办情况”时才显示）
import { 分组顺序, 报名状态 } from '../../../共用/推荐排序/index.mjs';

// 小程序的参数名 → 面板条件名，和它比的条目字段
const 面板参数 = {
  eventLevel: ['级别', 'level'],
  participationFormat: ['参赛形式', 'participation_format'],
  teamSizeCategory: ['队伍人数', 'team_size_category'],
  feeType: ['费用', 'fee_type'],
  registrationOrganization: ['报名方式', 'registration_organization'],
  region: ['地区', 'region'],
  lifecycle: ['举办情况', 'lifecycle'],
  registrationStatus: ['报名状态', null],
  profession: ['专业', null],
};
const 距报名天数 = { '1m': 31, '3m': 92, '6m': 183 };
const 编号格式 = /^[A-Za-z0-9_-]{1,128}$/;
const 最多标记 = 200;
const 天 = 24 * 60 * 60 * 1000;

function 字符串列表(值, 最多, 格式) {
  if (!Array.isArray(值)) return [];
  return [...new Set(值.filter(项 => typeof 项 === 'string' && 格式.test(项)))].slice(0, 最多);
}
const 范围内整数 = (值, 默认) => Math.max(1, Math.min(100, Number.isInteger(值) ? 值 : 默认));

export function 整理输入(请求 = {}) {
  const 面板 = {};
  for (const [参数, [名]] of Object.entries(面板参数)) {
    if (typeof 请求[参数] === 'string' && 请求[参数]) 面板[名] = 请求[参数];
  }
  return {
    关键词: String(请求.keyword || '').trim().slice(0, 100),
    专业们: 字符串列表(请求.categories, 13, /^.{1,20}$/),
    省份: typeof 请求.province === 'string' ? 请求.province.trim().slice(0, 20) : '',
    列表分组: 字符串列表(请求.listGroups, 分组顺序.length, /^.{1,10}$/).filter(名 => 分组顺序.includes(名)),
    面板,
    几天内能报: Object.hasOwn(距报名天数, 请求.registrationWithin) ? 距报名天数[请求.registrationWithin] : null,
    收藏: 字符串列表(请求.favoriteIds, 最多标记, 编号格式),
    提醒: 字符串列表(请求.reminderIds, 最多标记, 编号格式),
    页: 范围内整数(请求.page, 1),
    每页: 范围内整数(请求.pageSize, 8),
  };
}

// 距离“能报名”还有几天：报名中记 0；即将报名用报名开始；已归档用推算的下一届时间（有才算）；其余不知道，给 null
function 距能报名(item, now) {
  const 状态 = 报名状态(item, now);
  if (状态 === '报名中') return 0;
  const 目标 = item.status === '已归档' ? item.next_edition_estimate : 状态 === '即将报名' ? item.registration_start : null;
  if (!目标) return null;
  const 差 = (new Date(目标).getTime() - now.getTime()) / 天;
  return Number.isFinite(差) ? 差 : null;
}

export function 面板筛选(item, 条件, now = new Date()) {
  const { 面板 } = 条件;
  for (const [名, 字段] of Object.values(面板参数)) {
    if (字段 && 面板[名] && item[字段] !== 面板[名]) return false;
  }
  if (面板.报名状态 && 报名状态(item, now) !== 面板.报名状态) return false;
  if (面板.专业 && !(item.professions || []).includes(面板.专业)) return false;
  // 默认不显示已停办的，但明确筛“举办情况”时照样给（用户搜它时应看到已停办，而不是搜不到）
  if (!面板.举办情况 && item.lifecycle === '已停办') return false;
  if (条件.几天内能报 !== null) {
    const 天数 = 距能报名(item, now);
    if (天数 === null || 天数 > 条件.几天内能报) return false;
  }
  return true;
}
