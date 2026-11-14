// 把 04 的抽取结果并进候选，合成一条用新库字段名的记录：05 审核交给程序审核、三项核验的就是它，06 入库按它（核验改正后）写库。
// 来源：ingest-candidates.mjs 的 withExtraction、candidateToRecord.js（2026-11-01 改成新库的字段名）。
//
//   合成记录(data) → { name, organizer, participants, eligibility, format_and_rules, registration_start, registration_end, team_size,
//                      registration_method, registration_organization, fees, authority_signals, reward_highlights, introduction,
//                      registration_url, professions, sources: [{ url }] }
//   抽取到的字段优先，没抽到的用候选自己的；报名网址没有单独抽到时先用候选网址，三项核验会核对、改正。
//   补读到的官网正式通知（04 的 supplement）也算一条来源。
const 单项 = ['organizer', 'participants', 'eligibility', 'format_and_rules', 'registration_start', 'registration_end', 'team_size',
  'registration_method', 'registration_organization', 'fees'];

export function 合成记录(data = {}) {
  const fields = data.extraction?.fields || {};
  const 记录 = { name: fields.competition_name?.value || data.name || '' };
  if (fields.track_name?.value) 记录.track_name = fields.track_name.value;
  for (const name of 单项) 记录[name] = fields[name]?.value || data[name] || '';
  const 通知 = data.extraction?.supplement?.notice?.used ? data.extraction.supplement.notice.url : '';
  return {
    ...记录,
    authority_signals: fields.authority_signals || [],
    reward_highlights: (fields.reward_highlights || []).map(item => item.value),
    introduction: data.snippet || '',
    registration_url: data.registration_url || data.url || '',
    professions: data.professions || [],
    sources: [data.url, 通知].filter(Boolean).map(url => ({ url })),
  };
}
