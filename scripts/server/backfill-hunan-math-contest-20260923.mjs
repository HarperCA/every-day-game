// 补录第十届湖南省大学生数学竞赛的当届主办方通知；默认预览。
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const token=(await fs.readFile(path.join(here,'.admin-token'),'utf8')).trim();
const id='edition-hunan-no6';
const url='https://www.hnssxxh.org.cn/?p=778';
async function call(action,data={}){const r=await fetch('http://127.0.0.1:8787/api/adminData',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({adminToken:token,action,...data})});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.message||`HTTP ${r.status}`);return j.data}
const state=await call('bootstrap');
const found=state.records.filter(x=>x.id===id);
if(found.length!==1)throw new Error('target_not_unique');
const old=found[0];
if(old.dataStatus!=='draft'||old.sources?.length!==1||old.sources[0].url!== 'https://cxcyxy.hnust.edu.cn/docs/2026-03/57883ee81d034aefa495c2fab9be1567.pdf')throw new Error('target_changed');
if(old.schedule?.registration_end||old.registrationUrl)throw new Error('target_already_backfilled');
const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(15000)});
const html=await response.text();
if(response.status!==200||response.url!==url||!html.includes('2026年第十届湖南省大学生数学竞赛')||!html.includes('2026 年 9 月 30 日前'))throw new Error('official_page_changed');
console.log(JSON.stringify({version:state.stateVersions.records,id:old.id,name:old.name,officialUrl:url,sourceStatus:response.status,finalUrl:response.url,registrationEnd:'2026-09-30',competitionDate:'2026-11-14',registrationOrganization:'学校统一报送',registrationUrl:'未提供公开个人报名入口',fee:'省赛不收取报名费'},null,2));
if(!process.argv.includes('--apply'))process.exit(0);
const expect=process.argv[process.argv.indexOf('--expect-version')+1];
if(String(state.stateVersions.records)!==expect)throw new Error('version_changed');
const backupDir=path.join(here,'backups',`hunan-math-backfill-${new Date().toISOString().replace(/[:.]/g,'-')}`);
await fs.mkdir(backupDir,{recursive:true,mode:0o700});
await fs.writeFile(path.join(backupDir,'records-before.json'),JSON.stringify(state,null,2),{mode:0o600});
const now=new Date().toISOString();
const changed={...old,
  participants:'湖南省内高校所有在校大学生。',
  eligibility:'湖南省内高校所有在校大学生；学校组织校级预赛后择优推荐参加省赛，不接受个人直接报名。',
  formatAndRules:'2026年第十届省赛于11月14日9:00—11:30在各校分考点举行。设数学专业、非数学专业和高职高专类别；具体类别限制及考核内容见主办方当届通知。',
  participationFormat:'个人赛',teamSize:'个人参赛',teamSizeCategory:'个人',
  registrationMethod:'各高校统一报送盖章的校级组织方案和报名表至省赛组委会；不接受个人直接报名。',
  registrationOrganization:'参赛高校统一报名',registrationUrl:'',
  fees:'省级竞赛不收取报名费',feeType:'免费',
  lastVerifiedAt:now,updatedAt:now,updatedBy:'manual-official-source-backfill',
  schedule:{...old.schedule,registration_end:'2026-09-30',competition_start:'2026-11-14',competition_end:'2026-11-14',pending_announcement:false,time_note:'报名开始日期未在当届官方通知中注明；学校统一报名截止为2026-09-30，比赛为2026-11-14 09:00—11:30。'},
  sources:[...old.sources,{id:'source-hunan-no6-2026-official-notice',edition_id:id,url,source_type:'organizer_website',is_official:true,validity_status:'valid',published_at:'2026-09-07',last_verified_at:now,final_url:url,evidence_excerpt:'湖南省数学学会发布第十届当届通知：湖南省内高校在校生参赛；学校统一报名，9月30日前报送；11月14日比赛；省赛不收取报名费。'}],
  qualityIssues:['报名开始日期未在当届官方通知中注明','无个人直报入口；须由参赛高校统一报送报名表','校内选拔截止日期因学校而异，须向所在学校核对'],
  recommendation:{...old.recommendation,missing_information:['报名开始日期未在当届官方通知中注明','个人报名入口不存在；学校统一组织报名'],evidence_refs:[url]},
  aiReview:null,
};
const current=await call('bootstrap');
if(current.stateVersions.records!==state.stateVersions.records||JSON.stringify(current.records.find(x=>x.id===id))!==JSON.stringify(old))throw new Error('concurrent_change');
const next=current.records.map(x=>x.id===id?changed:x);
await call('saveRecords',{records:next,expectedVersion:current.stateVersions.records,auditEntry:{id:`backfill-hunan-math-${Date.now()}`,action:'update',objectType:'event_edition',recordId:id,recordName:old.name,changedFields:['sources','schedule','eligibility','formatAndRules','registrationMethod','fees','qualityIssues'],actor:'super_admin',reason:`按湖南省数学学会2026年第十届正式通知补录；备份：${backupDir}`,createdAt:now}});
const after=await call('bootstrap');
const saved=after.records.find(x=>x.id===id);
if(!saved||saved.schedule.registration_end!=='2026-09-30'||!saved.sources.some(x=>x.url===url))throw new Error('write_verification_failed');
console.log(JSON.stringify({updated:id,status:saved.dataStatus,total:after.records.length,backupDir,verified:true}));
