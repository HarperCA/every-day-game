// 后台“访问异常”页（2026-10-01 起）：小程序在用户手机上出的问题，经上海 clientLog 收集、
// 服务器 pull-client-logs.mjs 拉回本地后，在这里汇总。
//
// 成功率 = 成功加载 ÷ 总尝试：
//   成功加载 = 上海 publicData 当天成功次数（client_stats）+ 上海失败但退回美国成功的次数（cloud_fallback）
//   总尝试   = 成功加载 + 两边都失败的次数（load_failed）
// 上报可能晚到（手机断网时先存着，下次打开再发），所以当天的数字会被后来补发的记录修正。
const KIND_LABEL = {
  cloud_fallback:'上海失败，已退回美国服务器', load_failed:'加载失败（用户看到了报错）', slow:'加载超过 3 秒',
  user_data_failed:'登录/收藏/提醒失败', js_error:'小程序代码报错',
};

const beijingDate = iso => new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0, 10);

function aggregateClientIssues(issues = [], stats = [], { days = 14, now = new Date() } = {}) {
  const dates = [];
  for (let i = days - 1; i >= 0; i -= 1) dates.push(beijingDate(new Date(now.getTime() - i * 86400000).toISOString()));
  const inRange = new Set(dates);
  const daily = new Map(dates.map(date => [date, { date, shanghaiOk:0, fallback:0, failed:0, slow:0, userDataFailed:0, jsError:0 }]));
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
    return { ...day, attempts, successRate:attempts ? ok / attempts : null };
  });
  const total = rows.reduce((sum, day) => ({ ok:sum.ok + day.shanghaiOk + day.fallback, attempts:sum.attempts + day.attempts }), { ok:0, attempts:0 });
  recent.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return {
    days, kindLabels:KIND_LABEL,
    summary:{ attempts:total.attempts, successRate:total.attempts ? total.ok / total.attempts : null, issues:recent.length },
    daily:rows.reverse(), byKind, byNetwork, byAction,
    recent:recent.slice(0, 100),
  };
}

module.exports = { aggregateClientIssues, KIND_LABEL };
