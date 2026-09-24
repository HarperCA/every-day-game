// 用承办方当届正式通知恢复湖南省研究生法律案例大赛。默认预览。
import fs from 'node:fs/promises';
import path from 'node:path';

const base = '/opt/daily-contest';
const token = (await fs.readFile(path.join(base, '.admin-token'), 'utf8')).trim();
const id = 'edition-hunan-grad-law-case-2026';
const officialUrl = 'https://graduate.hnust.edu.cn/yjsgzb/xkjs/e6af6f8218ef4568a6d2821a50f1eb4b.htm';
async function call(action, data = {}) {
  const response = await fetch('http://127.0.0.1:8787/api/adminData', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({adminToken:token, action, ...data})});
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.message || `HTTP ${response.status}`);
  return result.data;
}
const state = await call('bootstrap');
const matches = state.records.filter(record => record.id === id);
if (matches.length !== 1 || !['quarantined', 'draft'].includes(matches[0].dataStatus)) throw new Error('target_not_unique_or_not_recoverable');
if (state.records.some(record => record.id !== id && /湖南省.*研究生.*法律案例大赛/.test(record.name || ''))) throw new Error('duplicate_exists');
const old = matches[0];
if (old.dataStatus === 'draft' && (old.organizer !== '湖南省教育厅（主办）、湖南科技大学（承办）' || old.registrationUrl !== officialUrl || old.quarantine !== null)) throw new Error('draft_identity_changed');
const nextStatus = old.dataStatus === 'quarantined' ? 'draft' : 'published';
if (old.dataStatus === 'quarantined') {
  const officialResponse = await fetch(officialUrl, {redirect:'follow', signal:AbortSignal.timeout(20000)});
  const html = await officialResponse.text();
  for (const marker of ['第十届湖南省研究生法律案例大赛', '湖南省教育厅主办', '湖南科技大学承办', '9月30日前', '2026年11月14-15日']) {
    if (!html.includes(marker)) throw new Error(`official_evidence_missing:${marker}`);
  }
  if (officialResponse.status !== 200 || officialResponse.url !== officialUrl) throw new Error('official_url_invalid');
} else {
  const verifiedAt = Date.parse(old.lastVerifiedAt || '');
  const officialSource = old.sources?.find(source => source.url === officialUrl && source.is_official && source.validity_status === 'valid');
  if (!officialSource || !Number.isFinite(verifiedAt) || Date.now() - verifiedAt > 60 * 60 * 1000 || old.schedule?.registration_end !== '2026-09-30T23:59:00+08:00') {
    throw new Error('recent_persisted_verification_missing');
  }
}
console.log(JSON.stringify({version:state.stateVersions.records,id,name:old.name,from:old.dataStatus,to:nextStatus,officialUrl,countBefore:state.records.length}));
if (!process.argv.includes('--apply')) process.exit(0);
const expectedVersion = process.argv[process.argv.indexOf('--expect-version') + 1];
if (expectedVersion !== String(state.stateVersions.records)) throw new Error('preview_version_changed');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(base, 'backups', `recover-hunan-law-case-${stamp}`);
await fs.mkdir(backupDir, {recursive:true, mode:0o700});
await fs.writeFile(path.join(backupDir, 'records-before.json'), JSON.stringify(state, null, 2), {mode:0o600});
const current = await call('bootstrap');
if (current.stateVersions.records !== state.stateVersions.records || JSON.stringify(current.records.find(record => record.id === id)) !== JSON.stringify(old)) throw new Error('concurrent_change');
const now = new Date().toISOString();
const updated = {
  ...old,
  organizer:'湖南省教育厅（主办）、湖南科技大学（承办）',
  participants:'湖南省各高校法律专业学位和法学学术学位全日制研究生。',
  eligibility:'湖南省各高校法律专业学位和法学学术学位全日制研究生；每支队伍由4名在籍研究生组成，指导教师不超过2名。',
  formatAndRules:'正式大赛分法律意见书竞赛和言词辩论竞赛两个阶段；言词辩论依次进行初赛、复赛、半决赛和决赛，采用现场评委评分和单场淘汰制。',
  teamSize:'每队4名学生，指导教师不超过2名',
  teamSizeCategory:'4～5人',
  registrationMethod:'参赛单位于2026年9月30日前将报名表提交至大赛组委会办公室指定邮箱。',
  registrationOrganization:'学校统一报名',
  registrationUrl:officialUrl,
  fees:'正式通知未说明收费',
  feeType:'暂未公布',
  dataStatus:nextStatus,
  systemValidation:'passed',
  manualReview:'passed',
  manualReviewReason:'已人工核验承办方2026年9月2日当届正式赛事通知。',
  qualityIssues:[],
  lastVerifiedAt:now,
  updatedAt:now,
  updatedBy:'manual-official-evidence-recovery',
  publishedAt:nextStatus === 'published' ? now : null,
  schedule:{...old.schedule,registration_start:null,registration_end:'2026-09-30T23:59:00+08:00',competition_start:'2026-11-14T00:00:00+08:00',competition_end:'2026-11-15T23:59:00+08:00',pending_announcement:false,status_override:'报名中',status_override_reason:'承办方9月2日发布正式通知，要求各单位于9月30日前报名。',time_note:'报名截止2026年9月30日；比赛时间2026年11月14—15日。'},
  sources:[{id:'source-hunan-grad-law-case-2026-official',edition_id:id,url:officialUrl,source_type:'organizer_notice',is_official:true,validity_status:'valid',published_at:'2026-09-02',last_verified_at:now,final_url:officialUrl,evidence_excerpt:'湖南科技大学正式通知：湖南省教育厅主办、湖南科技大学承办；9月30日前报名；11月14—15日比赛；每队4名在籍研究生。'}],
  recommendation:{...old.recommendation,system_validation:'passed',manual_review:'passed',published_cache:nextStatus === 'published'},
  needsManualReview:false,
  fieldVerification:null,
  aiReview:null,
  quarantine:null,
};
await call('saveRecords', {records:current.records.map(record => record.id === id ? updated : record), expectedVersion:current.stateVersions.records, auditEntry:{id:`recover-hunan-law-case-${Date.now()}`,action:nextStatus === 'published' ? 'publish' : 'update',objectType:'event_edition',recordId:id,recordName:old.name,changedFields:['dataStatus','organizer','eligibility','formatAndRules','schedule','registrationUrl','sources'],actor:'super_admin',reason:`${nextStatus === 'published' ? '通过审核并发布' : '补齐承办方当届正式通知后从误收隔离恢复为草稿'}；备份：${backupDir}`,createdAt:now}});
const after = await call('bootstrap');
const saved = after.records.find(record => record.id === id);
if (saved?.dataStatus !== nextStatus || saved.registrationUrl !== officialUrl || saved.schedule?.registration_end !== '2026-09-30T23:59:00+08:00') throw new Error('write_verification_failed');
console.log(JSON.stringify({updated:id,status:saved.dataStatus,version:after.stateVersions.records,backupDir,verified:true}));
