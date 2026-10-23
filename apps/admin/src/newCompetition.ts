export function createCompetitionDraft() {
  const key = crypto.randomUUID();
  const id = `edition-manual-${key}`;
  return {
    id, eventId: `event-manual-${key}`, name: '', editionName: '', editionYear: '', editionOrdinal: '', organizer: '',
    eventLevel: '其他/未明确', aliases: [], objectiveTags: [], professions: [],
    participants: '', eligibility: '', formatAndRules: '', teamSize: '',
    participationFormat: '暂未明确', teamSizeCategory: '暂未明确',
    registrationMethod: '', registrationOrganization: '暂未明确', registrationUrl: '', posterUrl: '',
    fees: '', feeType: '暂未公布', lastVerifiedAt: null,
    dataStatus: 'draft', systemValidation: 'not_run', manualReview: 'pending', qualityIssues: [],
    schedule: { id: `schedule-${id}`, edition_id: id, track_id: null,
      registration_start: null, registration_end: null, competition_start: null, competition_end: null,
      pending_announcement: false, status_override: null, status_override_reason: null, time_note: '', change_status: 'normal' },
    track: { id: `track-${id}`, edition_id: id, name: '', scope_note: '' },
    recommendation: { id: `recommendation-${id}`, edition_id: id, recommendation: '信息不足',
      suitable_for: '', reasons: [], evidence_refs: [], limitations: [], preparation: '', confidence: '低',
      missing_information: [], event_data_version: '', rule_version: '',
      system_validation: 'not_run', manual_review: 'pending', published_cache: false },
    sources: [], createdAt: new Date().toISOString(), createdBy: 'manual_admin',
  };
}

export function validateNewCompetition(record: any, records: any[]) {
  const errors: string[] = [];
  const normalize = (value: string) => String(value || '').normalize('NFKC').replace(/\s/g, '').toLowerCase();
  if (records.some(item => normalize(item.name) === normalize(record.name) && normalize(item.editionYear) === normalize(record.editionYear) && normalize(item.editionOrdinal) === normalize(record.editionOrdinal) && normalize(item.editionName) === normalize(record.editionName))) errors.push('该赛事届次已在比赛库中，请搜索后编辑原记录');
  if (!record.organizer?.trim()) errors.push('请填写主办单位');
  if (!record.participants?.trim() || !record.eligibility?.trim()) errors.push('请填写参赛对象及大学生参赛资格依据');
  if (!record.professions?.length || !record.formatAndRules?.trim()) errors.push('请填写适合专业和赛制与规则');
  if (!record.sources?.length) errors.push('请添加至少一条赛事来源网址');
  for (const url of [...(record.sources || []).map((source: any) => source.url), ...(record.registrationUrl ? [record.registrationUrl] : [])]) {
    try { if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error(); }
    catch { errors.push('来源及报名网址必须是完整的 http/https 链接'); break; }
  }
  return errors;
}
