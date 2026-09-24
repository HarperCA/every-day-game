import fs from 'node:fs';
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
async function call(payload) {
  const response = await fetch('http://127.0.0.1:8787/api/adminData', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ adminToken:token, ...payload }) });
  const result = await response.json();
  if (!result.ok) throw new Error(result.message);
  return result.data;
}
const snapshot = await call({ action:'bootstrap' });
const ids = new Set([
  'edition-search-f9921722de4b683d',
  'edition-search-0b8baa48740a7d1e',
  'edition-direct-baidu-5YWz5LqO6I2j5oiQ5a2m6Zmi',
  'edition-direct-baidu-MjAyNuW5tOWFqOWbvemrmOag',
]);
const matches = snapshot.records.filter(item => ids.has(item.id) && /跨境电商赛道/.test(item.name));
if (matches.length !== 4 || matches.some(item => item.dataStatus !== 'draft')) throw new Error(`目标记录数量或状态已变化，拒绝覆盖：${JSON.stringify(matches.map(item => [item.id, item.name, item.dataStatus]))}`);
const retained = matches[0];
const now = new Date().toISOString();
const name = '2026年全国高校商业精英挑战赛国际贸易竞赛跨境电商赛道（第十届）';
const updated = {
  ...retained, name, editionName:name,
  organizer:'中国国际贸易促进委员会商业行业委员会、中国国际商会商业行业商会、中国商业经济学会、中国国际贸易促进委员会江苏省分会、宿迁市人民政府',
  registrationUrl:'https://ssyth.cubec.org.cn/',
  registrationMethod:'参赛院校负责教师通过全国高校商业精英挑战赛赛事一体化平台报名登记。',
  schedule:{ ...retained.schedule, registration_end:'2026-09-20T23:59:00+08:00', time_note:'主办方通知要求参赛院校于2026年9月20日前完成登记，未给出当日具体截止时刻；23:59仅作日期边界展示。', pending_announcement:false },
  sources:[
    { id:`source-${retained.id}-organizer`, edition_id:retained.id, url:'https://www.ccpitcsc.org/eduxq/4871', source_type:'organizer_notice', is_official:true, validity_status:'valid', published_at:'2026-01-22', last_verified_at:now },
    { id:`source-${retained.id}-registration`, edition_id:retained.id, url:'https://ssyth.cubec.org.cn/', source_type:'registration_platform', is_official:true, validity_status:'valid', published_at:null, last_verified_at:now },
    { ...retained.sources[0], source_type:'university_notice', is_official:false, validity_status:'unchecked' },
  ],
  qualityIssues:['待确认本校是否仍接受报名；主办方登记日期为2026年9月20日，具体时刻未公布'],
  discoveryNoticeUrl:retained.sources[0].url,
  noticeResolution:{ proposedName:name, status:'已找到主办方赛事页与官方报名平台', leads:[] },
  lastVerifiedAt:now, updatedAt:now, updatedBy:'notice-resolution-correction',
};
const records = snapshot.records.filter(item => !matches.includes(item));
records.push(updated);
const result = await call({ action:'saveRecords', records, expectedVersion:snapshot.stateVersions.records,
  auditEntry:{ id:`correct-crossborder-notices-${Date.now()}`, action:'update', objectType:'event_edition', recordId:retained.id, recordName:name, changedFields:['name','editionName','organizer','registrationUrl','sources','schedule','duplicate_drafts'], actor:'super_admin', reason:'高校通知仅作线索；依据主办方赛事通知及官方报名平台统一赛事名称和来源，合并三条重复草稿', createdAt:now } });
console.log(JSON.stringify({ retainedId:retained.id, removedDuplicateIds:matches.slice(1).map(item => item.id), total:result.saved, version:result.version }, null, 2));
