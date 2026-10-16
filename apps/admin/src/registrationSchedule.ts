type Boundary = 'start' | 'end';

// A date without a time means the whole Beijing calendar day. In particular,
// a deadline of YYYY-MM-DD must not expire at the start of that day.
export function registrationInstant(value: unknown, boundary: Boundary): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = value.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return NaN;
  const [, year, month, day] = match.map(Number);
  if (new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== date) return NaN;
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (dated) return Date.parse(`${value}T${boundary === 'end' ? '23:59:59.999' : '00:00:00'}+08:00`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return NaN;
  return Date.parse(value);
}

export function registrationScheduleIssues(schedule: any): string[] {
  if (!schedule) return ['缺少时间安排记录'];
  const start = registrationInstant(schedule.registration_start, 'start');
  const end = registrationInstant(schedule.registration_end, 'end');
  const issues: string[] = [];
  if (start !== null && !Number.isFinite(start)) issues.push('报名开始时间格式无效');
  if (end !== null && !Number.isFinite(end)) issues.push('报名截止时间格式无效');
  if (Number.isFinite(start) && Number.isFinite(end) && start! > end!) issues.push('报名开始时间晚于报名截止时间');
  if (start === null && end === null && !schedule.pending_announcement) issues.push('报名起止时间均缺失，请核实或说明尚未公布');
  return issues;
}

export function unresolvedRegistrationQualityIssues(record: any): string[] {
  const issues = Array.isArray(record.qualityIssues) ? record.qualityIssues : [];
  const officialSources = (Array.isArray(record.sources) ? record.sources : []).filter((source: any) =>
    source?.id && source.source_type && source.is_official && source.validity_status === 'valid' && /^https?:\/\//i.test(source.url || ''));
  const resolved = (field: 'registration_start' | 'registration_end') => {
    const label = field === 'registration_start' ? '报名开始' : '报名截止';
    const date = record.schedule?.[field];
    if (date) return officialSources.some((source: any) => (source.supports_fields || []).some((item: unknown) =>
      typeof item === 'string' && (item.includes(field) || item.includes(label)) && !/未公布|待公布|待核实/.test(item)));
    if (!record.schedule?.pending_announcement) return false;
    return officialSources.some((source: any) => (source.supports_fields || []).some((item: unknown) =>
      typeof item === 'string' && (item.includes(field) || item.includes(label) || item.includes('报名时间')) && /未公布|待公布/.test(item)));
  };
  return issues.filter((issue: unknown) => {
    if (issue === 'registration_start_pending') return !resolved('registration_start');
    if (issue === 'registration_end_pending') return !resolved('registration_end');
    if (issue === 'registration_time_pending') return !(resolved('registration_start') && resolved('registration_end'));
    return true;
  });
}
