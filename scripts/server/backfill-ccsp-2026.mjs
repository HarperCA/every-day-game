import fs from 'node:fs';

const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const api = 'http://127.0.0.1:8787/api/adminData';
const notice = 'https://ccsp.ccf.org.cn/ccsp/tzgg/2026-09-09/931080.shtml';
const now = new Date().toISOString();
const ids = new Set([
  'edition-search-fbd665754b167e5c',
  'edition-search-3b2d2ddde011e61b',
  'edition-direct-baidu-MjAyNiBDQ0YgQ0NTUOernui1',
]);
async function call(body) {
  const response = await fetch(api, { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ adminToken:token, ...body }) });
  const result = await response.json();
  if (!result.ok) throw Error(result.message || 'adminData_failed');
  return result.data;
}
const state = await call({ action:'bootstrap' });
const matches = state.records.filter(r => ids.has(r.id));
if (matches.length !== 3 || matches.some(r => !r.name.includes('CCF CCSP竞赛') || !['draft', 'pending_manual_review'].includes(r.dataStatus))) {
  throw Error('CCSP 目标数量、名称或状态变化，停止回填');
}
const canonical = matches.find(r => r.id === 'edition-search-fbd665754b167e5c');
if (!canonical.sources?.some(s => s.url === notice)) throw Error('官方来源不符，停止回填');
const duplicateIds = new Set([...ids].filter(id => id !== canonical.id));
const revised = structuredClone(canonical);
revised.name = '2026 CCF CCSP竞赛';
revised.editionName = '2026 CCF CCSP竞赛';
revised.aliases = [...new Set([...(revised.aliases || []), canonical.name, '中国计算机学会大学生计算机系统与程序设计竞赛（2026）'])];
revised.organizer = '中国计算机学会（承办：西华大学）';
revised.participants = '全国高校在校生';
revised.eligibility = '全国高校在校生；第37～43次CSP认证任意一次最好成绩达到200分及以上，按成绩及报名顺序择优，名额有限。';
revised.formatAndRules = '全国赛机考，共5题、每题100分，总分500分；考察编程与计算机系统能力，使用C/C++、Java或Python。';
revised.registrationMethod = '登录CCF CCSP报名系统，选择“2026 CCF CCSP竞赛”及西华大学考点，填写信息；可由学校团报统一缴费，或个人报名缴费，审核通过后打印准考证。';
revised.registrationOrganization = '两种方式均可';
revised.registrationUrl = 'https://www.ccf.org.cn/ccsp/';
revised.fees = '10月9日前缴费：CCF会员500元/人、非会员800元/人；10月11日前缴费：会员800元/人、非会员1000元/人。住宿、餐饮和交通自理。';
revised.feeType = '收费';
revised.schedule.registration_start = '2026-09-09';
revised.schedule.registration_end = '2026-10-11';
revised.schedule.competition_start = '2026-10-21T09:00:00+08:00';
revised.schedule.competition_end = '2026-10-21T21:00:00+08:00';
revised.schedule.pending_announcement = false;
revised.schedule.time_note = '报名公告仅公布日期，未说明具体截止时刻；竞赛时间为北京时间10月21日9:00—21:00。';
revised.lastVerifiedAt = now;
revised.updatedAt = now;
revised.updatedBy = 'manual-official-backfill';
revised.dataStatus = 'draft';
revised.systemValidation = 'not_run';
revised.manualReview = 'pending';
revised.qualityIssues = (revised.qualityIssues || []).filter(s => !/主办方待确认|报名开始时间待确认|报名截止时间待确认/.test(s));
revised.qualityIssues.push(`2026-09-22 官方原文回填：参赛对象、资格、赛制、报名流程、报名入口、收费及竞赛时间；证据：${notice}`);
revised.sources = revised.sources.map(s => s.url === notice ? { ...s, is_official:true, validity_status:'valid', last_verified_at:now } : s);
const backup = `/opt/daily-contest/backups/ccsp-before-backfill-${Date.now()}.json`;
console.log(JSON.stringify({version:state.stateVersions.records,total:state.records.length,update:canonical.id,removeDuplicates:[...duplicateIds],backup,fields:['name','organizer','participants','eligibility','formatAndRules','registrationMethod','registrationUrl','fees','schedule'] }));
if (!process.argv.includes('--apply')) process.exit(0);
fs.writeFileSync(backup, JSON.stringify({ version:state.stateVersions.records, records:state.records, updatedAt:now }), {mode:0o600,flag:'wx'});
const next = state.records.filter(r => !duplicateIds.has(r.id)).map(r => r.id === canonical.id ? revised : r);
await call({ action:'saveRecords', records:next, expectedVersion:state.stateVersions.records, auditEntry:{
  id:`ccsp-official-backfill-${Date.now()}`, action:'update', objectType:'event_edition', recordId:canonical.id, recordName:revised.name,
  changedFields:['name','organizer','participants','eligibility','formatAndRules','registrationMethod','registrationUrl','fees','feeType','schedule','sources','duplicate_removed'],
  actor:'super_admin', reason:`按中国计算机学会当届公告补齐漏录字段，并合并两条同届重复草稿。原库完整备份：${backup}；官方证据：${notice}`, createdAt:now,
} });
const after = await call({action:'bootstrap'});
const actual = after.records.find(r => r.id === canonical.id);
if (!actual || after.records.some(r => duplicateIds.has(r.id)) || actual.registrationUrl !== revised.registrationUrl || actual.eligibility !== revised.eligibility) throw Error('写后读取核验失败');
console.log(JSON.stringify({verified:true,version:after.stateVersions.records,total:after.records.length,canonical:actual.name,removedDuplicateCount:duplicateIds.size,backup}));
