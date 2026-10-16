export const qualityIssueLabels: Record<string, string> = {
  source_reachability_not_checked: '来源链接尚未核验能否打开',
  track_requires_official_split: '组合赛项需按官方资料拆分',
  edition_year_missing: '届次年份缺失',
  registration_start_pending: '报名开始时间待核实',
  registration_end_pending: '报名截止时间待核实',
  registration_time_pending: '报名时间待官方确认',
  registration_url_pending: '报名入口待官方确认',
  source_missing: '缺少官方数据来源',
  profession_mapping_pending: '适合专业待人工确认',
  notice_resolution_pending: '通知线索待追溯赛事官网及官方报名入口',
  user_feedback_requires_review: '用户纠错信息待人工复核',
};

export function displayQualityIssue(issue: string): string {
  const label = qualityIssueLabels[issue];
  if (label) return `${label}（${issue}）`;
  if (/^[a-z][a-z0-9_]+$/.test(issue)) return `未配置中文说明，待人工核对（${issue}）`;
  return issue;
}

export function parseQualityIssueLines(value: string): string[] {
  return value.split(/\r?\n/).map(line => {
    const trimmed = line.trim();
    const match = /^.*（([a-z][a-z0-9_]+)）$/.exec(trimmed);
    return match ? match[1] : trimmed;
  }).filter(Boolean);
}
