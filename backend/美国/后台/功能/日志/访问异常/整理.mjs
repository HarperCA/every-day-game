// 访问异常 · 整理（纯计算）：照旧后台 adminData/clientIssues.js 的 aggregateClientIssues 搬（2026-11-02），算法和输出字段不变：
//   成功率 = 成功加载 ÷ 总尝试；成功加载 = 当天成功次数（client_stats）+ 退回另一台成功的次数（cloud_fallback）；总尝试 = 成功加载 + 都失败的次数（load_failed）
//   上报可能晚到（手机断网时先存着，下次打开再发），所以当天的数字会被后来补发的记录修正。
// 加载统计现在由北京记（原来是上海）；cloud_fallback 是旧小程序的“上海失败退回美国”，小程序改连北京后就不会再有。
//   整理(原始, { 天数 = 14 }) → { days, kindLabels, summary, daily, byKind, byNetwork, byAction, recent, 接好了, 来源 }
const KIND_LABEL = {
  cloud_fallback: '上海失败，已退回美国服务器', load_failed: '加载失败（用户看到了报错）', slow: '加载超过 3 秒',
  user_data_failed: '登录/收藏/提醒失败', js_error: '小程序代码报错',
};

const beijingDate = iso => new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0, 10);

function aggregateClientIssues(issues = [], stats = [], { days = 14, now = new Date() } = {}) {
  const dates = [];
  for (let i = days - 1; i >= 0; i -= 1) dates.push(beijingDate(new Date(now.getTime() - i * 86400000).toISOString()));
  const inRange = new Set(dates);
  const daily = new Map(dates.map(date => [date, { date, shanghaiOk: 0, fallback: 0, failed: 0, slow: 0, userDataFailed: 0, jsError: 0 }]));
  for (const row of stats) {
    const day = daily.get(row?.date);
    if (day) day.shanghaiOk = (Number(row.list) || 0) + (Number(row.get) || 0);
  }
  const recent = [];
  const byKind = {};
  const byNetwork = {};
  const byAction = {};
  for (const issue of issues) {
    const date = beijingDate(issue.at || issue.received_at);
    if (!inRange.has(date)) continue;
    const day = daily.get(date);
    if (issue.kind === 'cloud_fallback') day.fallback += 1;
    else if (issue.kind === 'load_failed') day.failed += 1;
    else if (issue.kind === 'slow') day.slow += 1;
    else if (issue.kind === 'user_data_failed') day.userDataFailed += 1;
    else if (issue.kind === 'js_error') day.jsError += 1;
    byKind[issue.kind] = (byKind[issue.kind] || 0) + 1;
    byNetwork[issue.networkType || 'unknown'] = (byNetwork[issue.networkType || 'unknown'] || 0) + 1;
    if (issue.action) byAction[issue.action] = (byAction[issue.action] || 0) + 1;
    recent.push(issue);
  }
  const rows = [...daily.values()].map(day => {
    const ok = day.shanghaiOk + day.fallback;
    const attempts = ok + day.failed;
    return { ...day, attempts, successRate: attempts ? ok / attempts : null };
  });
  const total = rows.reduce((sum, day) => ({ ok: sum.ok + day.shanghaiOk + day.fallback, attempts: sum.attempts + day.attempts }), { ok: 0, attempts: 0 });
  recent.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return {
    days, kindLabels: KIND_LABEL,
    summary: { attempts: total.attempts, successRate: total.attempts ? total.ok / total.attempts : null, issues: recent.length },
    daily: rows.reverse(), byKind, byNetwork, byAction,
    recent: recent.slice(0, 100),
  };
}

export function 整理(原始, 条件 = {}) {
  if (!原始?.接好了) return { 接好了: false, 来源: 原始?.来源 };
  // 用户副本里存的是带编号的整行，汇总只看旧字段
  const issues = 原始.issues.map(({ id: _编号, ...行 }) => 行);
  return { ...aggregateClientIssues(issues, 原始.stats, { days: Number(条件.天数) || 14, now: new Date(原始.现在) }), 接好了: true, 来源: 原始.来源 };
}
