// 报名状态和状态分组（《第一步：排序规则》第 ③ 条）。
// 从旧代码搬来，逻辑不变：publicData/publicQuery.js 的 registrationInstant、currentRegistrationStatus，listOrder.js 的 listGroup。
// 字段用新比赛库的名字：status（'已归档' 等）、status_override（人工指定的报名状态）、registration_start/end、competition_start/end。
// 日期一律按北京时间。

export const 分组顺序 = ['报名中', '时间待公布', '比赛中', '比赛已结束'];

// 日期或时间换成毫秒。只写日期的：开始算当天 0 点，截止算当天 23:59:59.999（北京时间）；没填或认不出给 null。
export function 时刻(value, 边界) {
  if (!value) return null;
  const text = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? `${text}T${边界 === '截止' ? '23:59:59.999' : '00:00:00'}+08:00` : text;
  const instant = Date.parse(normalized);
  return Number.isFinite(instant) ? instant : null;
}

// 报名中、即将报名、时间待公布、已截止
export function 报名状态(item, now = new Date()) {
  if (item.status === '已归档') return '已截止';
  const t = now.getTime();
  const start = 时刻(item.registration_start, '开始');
  const end = 时刻(item.registration_end, '截止');
  if (end !== null && t > end) return '已截止';
  // 没有报名截止日、但比赛结束日已过：报名肯定已经结束
  const competitionEnd = 时刻(item.competition_end, '截止');
  if (end === null && competitionEnd !== null && t > competitionEnd) return '已截止';
  if (item.status_override) return item.status_override;
  if (start === null) return '时间待公布';
  if (t < start) return '即将报名';
  // 已开始、没有统一截止日：算报名中；但比赛已经开始的，报名多半已经结束、只是没拿到截止日，显示时间待公布
  if (end === null) {
    const competitionStart = 时刻(item.competition_start, '开始');
    if (competitionStart !== null && t > competitionStart) return '时间待公布';
  }
  return '报名中';
}

// 报名中 → 时间待公布（含即将报名）→ 比赛中（报名已截止、今天没过比赛结束日）→ 比赛已结束
export function 状态分组(item, now = new Date()) {
  const status = 报名状态(item, now);
  if (status === '报名中') return '报名中';
  if (status === '时间待公布' || status === '即将报名') return '时间待公布';
  const competitionEnd = 时刻(item.competition_end, '截止');
  return competitionEnd !== null && now.getTime() <= competitionEnd ? '比赛中' : '比赛已结束';
}
