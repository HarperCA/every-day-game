// 公开数据：接替上海云函数 publicData（2026-11-02），去掉云函数的兼容外壳。说明见同目录 README.md。
//   list  首页列表：交给用户呈现模块（另一个会话写的，按 2026-11-01 定的推荐规则排序；字段名沿用上海的列表），不搬上海 publicData 的列表代码（用户 11-02 定）
//   get   详情：从主数据库读一届，交回它的全部公开内容，加上上海详情页用的几个字段名和算好的报名状态
// 两个动作都记一次加载成功（收集报错的统计表，上海的 client_stats），记不上不影响返回。
// 不用登录也能看；登录了的，首页按他的收藏、提醒、偏好排：用户编号按入口核验过的 openid 查，不信小程序传的。
// 上海的 warm（保持云函数不休眠）、实例缓存不再需要：北京是常驻的服务器进程。
//
//   handle({ action, query | id }, { 主库, 用户库, 报错库, openid, now, 海报地址, 海报目录 }) → { ok: true, data } 或 { ok: false, message }
import { 报名状态, 时间可靠度 } from '../../../共用/推荐排序/index.mjs';
import { 公开 } from '../../主数据库/index.mjs';
import { 用户 } from '../../副数据库/index.mjs';
import { 呈现首页 } from '../../用户呈现模块/index.mjs';

const 编号格式 = /^[\w.:-]{1,200}$/;
const 北京日期 = t => new Date(t.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);

function 记加载(报错库, now, 动作) {
  try { 报错库?.加一(北京日期(now), 动作); } catch (error) { console.error('[公开数据] 记加载次数失败', error?.message); }
}

// 学校报名时间提示：照上海 adminData/competitionValue.js 的 schoolTimingAdvice，文字原样。可靠度用 共用/推荐排序 的 时间可靠度，换成上海的英文值
const 可靠度英文 = { 学校决定: 'school_controlled', 未核实: 'unverified', 官方: 'official' };
const 学校时间说明 = {
  需先校内选拔: '需先通过校内选拔。校赛时间各校不同，通常远早于官方截止日，很可能已经开始组队。',
  学校统一报名: '由学校统一报名。你校的内部截止日期通常早于官方日期。',
  以赛区或学校通知为准: '报名时间以赛区或学校通知为准，官方日期仅供参考。',
  两种方式均可: '可自行报名，也可能由学校统一组织，两条路的截止时间不一定相同。',
  暂未明确: '报名组织方式尚未确认，官方日期可能不是你实际要赶的时间。',
};
const 去问学校 = '请尽快向教务处、学院或指导老师确认本校安排，不要等到官方截止日。';
function 学校时间提示(item) {
  const reliability = 可靠度英文[时间可靠度(item)];
  if (reliability === 'official') return { school_timing_dependent: false, school_timing_note: '', timing_reliability: reliability };
  const 说明 = 学校时间说明[item.registration_organization] || 学校时间说明.暂未明确;
  return { school_timing_dependent: true, school_timing_note: `${说明}${去问学校}`, timing_reliability: reliability };
}

// 推荐：上海公开缓存拆成平铺的 recommendation_*（adminData/publicCache.js toPublicCache），没有的给空
function 推荐字段(推荐) {
  const r = 推荐 && typeof 推荐 === 'object' ? 推荐 : {};
  return {
    recommendation: typeof 推荐 === 'string' ? 推荐 : r.recommendation || '信息不足',
    recommendation_reasons: Array.isArray(r.reasons) ? r.reasons : [],
    recommendation_suitable_for: String(r.suitable_for || ''),
    recommendation_limitations: Array.isArray(r.limitations) ? r.limitations : [],
    recommendation_preparation: String(r.preparation || ''),
    recommendation_confidence: String(r.confidence || ''),
  };
}

// 详情：全部公开内容 + 上海详情页认的几个字段名（和首页卡片的取法一样，见 用户呈现模块/返回/）
// 2026-11-02 按小程序 services/publicRecord.ts hydratePublic 读的字段核对过；registration_end_note 建库时已并进 time_note，不单给
function 详情(item, now) {
  return {
    ...item,
    event_id: item.competition_id,
    event_level: item.level,
    data_status: item.status === '已归档' ? 'archived' : 'published',
    registration_status: 报名状态(item, now),
    ...推荐字段(item.recommendation),
    ...学校时间提示(item),
  };
}

export async function handle(request = {}, { 主库, 用户库, 报错库, openid, now = () => new Date(), 海报地址 = '', 海报目录 } = {}) {
  const 现在 = now();
  try {
    if (request.action === 'list') {
      const 用户id = openid && 用户库 ? 用户.按openid(用户库, openid)?.id ?? null : null;
      const data = 呈现首页(request.query || {}, { 主库, 副库: 用户库, 用户id, now: 现在, 海报地址, 海报目录 });
      记加载(报错库, 现在, 'list');
      return { ok: true, data };
    }
    if (request.action === 'get') {
      const item = typeof request.id === 'string' && 编号格式.test(request.id) ? 公开.届次(主库, request.id) : null;
      if (!item) return { ok: false, message: 'public_record_not_found' };
      记加载(报错库, 现在, 'get');
      return { ok: true, data: 详情(item, 现在) };
    }
    return { ok: false, message: 'unsupported_action' };
  } catch (error) {
    console.error('[公开数据] 出错', { action: request.action, error: error?.message });
    return { ok: false, message: error instanceof Error ? error.message : 'public_data_failed' };
  }
}
