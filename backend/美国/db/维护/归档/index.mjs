// 每日归档（2026-11-03 用户定）：放在维护文件夹里，但自己每天跑一次（定时器每天 2:00，见 ../../../定时/），不走“每次维护一个比赛”的轮流。
// 把报名已截止、还挂着已发布的届次全部改成已归档，并算出下一届大概什么时候报名。写比赛库经 db/index.mjs 的 届次.归档。
//
// 规则照旧系统线上代码搬，逻辑不变（11-03 从美国服务器拷下比对）：
//   adminData/archiveSchedule.js       shouldArchive、estimateNextEditionStart
//   adminData/registrationSchedule.js  registrationInstant、registrationScheduleIssues（时间安排有问题的不归，等人改）
//   adminData/publicCache.js           registrationStatus（这里只用到“是不是已截止”）
// 日期按北京时间：只写日期的截止算当天 23:59:59.999，所以截止当天不归，第二天才归。
// 下一届预计：这一届报名开始时间（没有就用比赛开始时间）往后推 365 天；只是参考，不是官方信息。
//
//   要归档吗(届次, now) → true/false
//   下一届预计(届次) → ISO 时间或 null
//   每日归档(db, { now, 试跑, 操作人 }) → { 检查了, 归档了: [{ id, 名称, 下一届预计 }], 失败: [{ id, 原因 }] }
import { 届次 } from '../../index.mjs';

const 一年 = 365 * 24 * 60 * 60 * 1000;

// 旧 registrationInstant：没填 → null；格式不对、日期不存在 → NaN
function 时刻(值, 边界) {
  if (typeof 值 !== 'string' || !值.trim()) return null;
  const 日期 = 值.slice(0, 10);
  const 对 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(日期);
  if (!对) return NaN;
  const [, 年, 月, 日] = 对.map(Number);
  if (new Date(Date.UTC(年, 月 - 1, 日)).toISOString().slice(0, 10) !== 日期) return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(值)) return Date.parse(`${值}T${边界 === 'end' ? '23:59:59.999' : '00:00:00'}+08:00`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(值)) return NaN;
  return Date.parse(值);
}

// 旧 registrationScheduleIssues：有问题的不归档
function 时间安排有问题(届) {
  const 开始 = 时刻(届.registration_start, 'start');
  const 截止 = 时刻(届.registration_end, 'end');
  if (开始 !== null && !Number.isFinite(开始)) return true;
  if (截止 !== null && !Number.isFinite(截止)) return true;
  if (Number.isFinite(开始) && Number.isFinite(截止) && 开始 > 截止) return true;
  return 开始 === null && 截止 === null && !届.pending_announcement;
}

// 旧 registrationStatus 里决定“已截止”的部分：截止已过；没有截止日但比赛已结束；人工指定为已截止
function 已截止(届, now) {
  const t = now.getTime();
  const 截止 = 时刻(届.registration_end, 'end');
  if (截止 !== null && t > 截止) return true;
  const 比赛结束 = 时刻(届.competition_end, 'end');
  if (截止 === null && 比赛结束 !== null && t > 比赛结束) return true;
  return 届.status_override === '已截止';
}

export function 要归档吗(届, now = new Date()) {
  return 届.status === '已发布' && !时间安排有问题(届) && 已截止(届, now);
}

export function 下一届预计(届) {
  const 基准 = 届.registration_start || 届.competition_start;
  if (!基准) return null;
  const t = new Date(基准);
  return Number.isNaN(t.getTime()) ? null : new Date(t.getTime() + 一年).toISOString();
}

export function 每日归档(db, { now = new Date(), 试跑 = false, 操作人 = '每日归档' } = {}) {
  const 已发布 = db.find('edition', { status: '已发布' }, { orderBy: 'id' });
  const 归档了 = [];
  const 失败 = [];
  for (const 届 of 已发布.filter(e => 要归档吗(e, now))) {
    const 预计 = 下一届预计(届);
    try {
      if (!试跑) 届次.归档(db, 届.id, 届.version, { 下一届预计: 预计 }, { 操作人, at: now.toISOString() });
      归档了.push({ id: 届.id, 名称: 届.edition_name, 下一届预计: 预计 });
    } catch (错误) {
      // 一届出错（比如刚被人改过、版本号对不上）不挡别的，明天再归
      失败.push({ id: 届.id, 原因: String(错误?.message || 错误).slice(0, 200) });
    }
  }
  return { 检查了: 已发布.length, 归档了, 失败 };
}
