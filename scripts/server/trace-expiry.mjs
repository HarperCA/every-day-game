// 追溯期限是处理任务的期限，不是赛事身份判定。逾期只标记待办，保持草稿状态。
export const OVERDUE_TRACE_PREFIX = '追溯逾期：';

export function markOverdueTrace(record, now = new Date()) {
  const dueAt = Date.parse(record.triage?.traceDue || '');
  if (record.dataStatus !== 'draft' || record.triage?.bucket !== '需要追溯'
    || !Number.isFinite(dueAt) || dueAt >= now.getTime()) return record;

  const issue = `${OVERDUE_TRACE_PREFIX}${String(record.triage.traceDue).slice(0, 10)} 前应核查当届官方原文；${record.triage.traceTodo || '待确认赛事来源'}`;
  const current = Array.isArray(record.qualityIssues) ? record.qualityIssues : [];
  if (current.includes(issue)) return record;
  return {
    ...record,
    qualityIssues: [...current.filter(item => !String(item).startsWith(OVERDUE_TRACE_PREFIX)), issue],
    updatedAt: now.toISOString(),
    updatedBy: 'draft-triage-expire-trace',
  };
}
