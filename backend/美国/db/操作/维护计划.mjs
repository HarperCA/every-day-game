// 调度：每个比赛多久查一次、现在该不该查、先查谁（2026-11-07 用户定）。只读比赛库，不改任何东西。
//
// 按“离预计报名时间还有多久”分档（一个月按 30 天算）：
//   还没到：4 个月以上每 3 个月；2–4 个月每月；半个月–2 个月每半月；半个月以内每周
//   过了预计时间还没发现新一届：过了半个月以内每周；半个月–3 个月每月；3 个月以上每 3 个月
//   正在报名中：每月      没有预计时间：每月
// 预计报名时间看最新一届（ordinal 最大、没删的）：
//   报名开始还没到 → 就是报名开始；
//   已截止 → 存着的下一届预计（每日归档算的），没存就用报名开始（没有就比赛开始）往后推 365 天；
//   最新一届一个时间都没有（刚建的新一届、待公布）→ 用上一届照上面推。
// 日期规则同 ../../维护/归档/：按北京时间，只写日期的开始算 0 点、截止算当天 23:59:59.999；写错的当作没写。
// 上次检查用比赛的 last_maintained_at。
//
//   检查频率(届次们, now) → { 情况, 频率, 间隔天数, 预计报名 }
//   下次检查(比赛, 届次们, now) → { ...检查频率, 上次检查, 下次检查, 到期 }   下次检查为 null 表示从没查过、马上查
//   挑要查的(db, { now, 上限 }) → [{ 比赛, 名称, ...下次检查 }]   只要到期的；间隔短的先，同间隔越早该查的越先
const 天 = 24 * 60 * 60 * 1000;
const 一年 = 365 * 天;

const 档 = {
  每周: { 频率: '每周', 间隔天数: 7 },
  每半月: { 频率: '每半月', 间隔天数: 15 },
  每月: { 频率: '每月', 间隔天数: 30 },
  每3个月: { 频率: '每3个月', 间隔天数: 90 },
};

// 时间字符串 → 毫秒；没写、写错 → null
function 时刻(值, 边界 = 'start') {
  if (typeof 值 !== 'string' || !值.trim()) return null;
  const 对 = /^(\d{4})-(\d{2})-(\d{2})/.exec(值);
  if (!对) return null;
  const [, 年, 月, 日] = 对.map(Number);
  if (new Date(Date.UTC(年, 月 - 1, 日)).toISOString().slice(0, 10) !== 值.slice(0, 10)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(值)) return Date.parse(`${值}T${边界 === 'end' ? '23:59:59.999' : '00:00:00'}+08:00`);
  const t = Date.parse(值);
  return Number.isFinite(t) ? t : null;
}

// 一届的报名情况：{ 报名中: true } / { 预计: 毫秒 } / { 已截止: true, 预计: 毫秒或 null } / null（一个时间都没有）
function 这一届(届, t) {
  const 开始 = 时刻(届.registration_start);
  const 截止 = 时刻(届.registration_end, 'end');
  const 比赛开始 = 时刻(届.competition_start);
  const 比赛结束 = 时刻(届.competition_end, 'end');
  const 推一年 = () => {
    const 存的 = 时刻(届.next_edition_estimate);
    if (存的 !== null) return 存的;
    const 基准 = 开始 ?? 比赛开始;
    return 基准 === null ? null : 基准 + 一年;
  };
  if (届.status_override === '已截止') return { 已截止: true, 预计: 推一年() };
  if (届.status_override === '报名中') return { 报名中: true };
  if (开始 !== null && 开始 > t) return { 预计: 开始 };
  if (截止 !== null) return t <= 截止 ? { 报名中: true } : { 已截止: true, 预计: 推一年() };
  if (开始 !== null) return 比赛结束 !== null && t > 比赛结束 ? { 已截止: true, 预计: 推一年() } : { 报名中: true };
  if (比赛结束 !== null && t > 比赛结束) return { 已截止: true, 预计: 推一年() };
  if (时刻(届.next_edition_estimate) !== null) return { 已截止: true, 预计: 推一年() };
  return null;
}

function 分档(预计, t) {
  const 差 = (预计 - t) / 天;   // 正数：还有几天；负数：过了几天
  if (差 >= 0) {
    if (差 > 120) return { 情况: '窗口外', ...档.每3个月 };
    if (差 > 60) return { 情况: '2到4个月', ...档.每月 };
    if (差 > 15) return { 情况: '半个月到2个月', ...档.每半月 };
    return { 情况: '半个月内', ...档.每周 };
  }
  if (-差 <= 15) return { 情况: '过期半个月内', ...档.每周 };
  if (-差 <= 90) return { 情况: '过期半个月到3个月', ...档.每月 };
  return { 情况: '过期3个月以上', ...档.每3个月 };
}

export function 检查频率(届次们, now = new Date()) {
  const t = now.getTime();
  const 从新到旧 = (届次们 || []).filter(e => !e.deleted_at).sort((a, b) => b.ordinal - a.ordinal);
  for (const 届 of 从新到旧) {
    const 情况 = 这一届(届, t);
    if (!情况) continue;   // 一个时间都没有，看上一届
    if (情况.报名中) return { 情况: '报名中', ...档.每月, 预计报名: null };
    if (情况.预计 === null) break;
    return { ...分档(情况.预计, t), 预计报名: new Date(情况.预计).toISOString() };
  }
  return { 情况: '没有预计时间', ...档.每月, 预计报名: null };
}

export function 下次检查(比赛, 届次们, now = new Date()) {
  const 频率 = 检查频率(届次们, now);
  const 上次 = 时刻(比赛?.last_maintained_at);
  if (上次 === null) return { ...频率, 上次检查: null, 下次检查: null, 到期: true };
  const 下次 = 上次 + 频率.间隔天数 * 天;
  return { ...频率, 上次检查: new Date(上次).toISOString(), 下次检查: new Date(下次).toISOString(), 到期: 下次 <= now.getTime() };
}

export function 挑要查的(db, { now = new Date(), 上限 = Infinity } = {}) {
  const 按比赛 = new Map();
  for (const 届 of db.find('edition', {}, { orderBy: 'id' })) {
    if (!按比赛.has(届.competition_id)) 按比赛.set(届.competition_id, []);
    按比赛.get(届.competition_id).push(届);
  }
  const 早晚 = x => (x.下次检查 === null ? -Infinity : Date.parse(x.下次检查));
  return db.find('competition', {}, { orderBy: 'id' })
    .map(比赛 => ({ 比赛: 比赛.id, 名称: 比赛.name, ...下次检查(比赛, 按比赛.get(比赛.id), now) }))
    .filter(x => x.到期)
    .sort((a, b) => a.间隔天数 - b.间隔天数 || 早晚(a) - 早晚(b) || (a.比赛 < b.比赛 ? -1 : 1))
    .slice(0, 上限);
}
