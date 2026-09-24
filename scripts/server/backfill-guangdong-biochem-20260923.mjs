// 按华南农业大学当届通知补录广东省大学生生物化学实验技能大赛；默认预览。
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));const token=(await fs.readFile(path.join(here,'.admin-token'),'utf8')).trim();
const id='edition-guangdong-no10',url='https://life.scau.edu.cn/2026/0709/c20173a439861/page.htm';
async function call(action,data={}){const r=await fetch('http://127.0.0.1:8787/api/adminData',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({adminToken:token,action,...data})});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.message||`HTTP ${r.status}`);return j.data}
const state=await call('bootstrap');const matches=state.records.filter(x=>x.id===id);if(matches.length!==1)throw new Error('target_not_unique');const old=matches[0];
if(old.dataStatus!=='draft'||old.sources?.length!==1||old.schedule?.registration_end||old.registrationUrl)throw new Error('target_changed');
const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(15000)});const html=await r.text();
if(r.status!==200||r.url!==url||!html.includes('2026年广东省大学生生物化学实验技能大赛')||!html.includes('scaush@163.com')||!html.includes('报名参加初赛'))throw new Error('official_page_changed');
console.log(JSON.stringify({version:state.stateVersions.records,id,name:old.name,officialUrl:url,finalUrl:r.url,registrationEnd:'2026-10-08 22:00',organizer:'广东省教育厅',host:'华南农业大学',method:'学校统一邮件报名'},null,2));
if(!process.argv.includes('--apply'))process.exit(0);
if(process.argv[process.argv.indexOf('--expect-version')+1]!==String(state.stateVersions.records))throw new Error('preview_changed');
const backupDir=path.join(here,'backups',`guangdong-biochem-backfill-${new Date().toISOString().replace(/[:.]/g,'-')}`);await fs.mkdir(backupDir,{recursive:true,mode:0o700});await fs.writeFile(path.join(backupDir,'records-before.json'),JSON.stringify(state,null,2),{mode:0o600});
const now=new Date().toISOString();const changed={...old,
  organizer:'广东省教育厅（主办）／华南农业大学（承办）',
  participants:'广东省教育厅管辖范围内高校全日制在校本、专科学生；香港、澳门高校大学生亦可参加。',
  eligibility:'各校通过校内赛择优推荐；每队学生不超过3人、指导教师不超过2人；由学校统一报名，不接受个人名义报名。',
  formatAndRules:'分本科组和高职高专组。初赛提交生物化学实验项目书，评审科学性、创新性、实验结果及格式；决赛含现场答辩与实验操作，初赛占总分30%、决赛占70%。',
  teamSize:'每队不超过3名学生',participationFormat:'团队赛',teamSizeCategory:'1-3人',
  registrationMethod:'以学校为单位统一将报名表、实验项目书及汇总表发送至组委会邮箱 scaush@163.com；不接受个人报名。',
  registrationOrganization:'参赛高校统一报名',registrationUrl:'',lastVerifiedAt:now,updatedAt:now,updatedBy:'manual-official-source-backfill',
  schedule:{...old.schedule,registration_end:'2026-10-08',competition_start:'2026-11-07',competition_end:'2026-11-08',pending_announcement:false,time_note:'学校统一报名截止为2026-10-08 22:00；校内选拔截止日期因学校而异；决赛计划11月7—8日，初赛评审10月14—20日。'},
  sources:[...old.sources,{id:'source-guangdong-no10-2026-host-notice',edition_id:id,url,source_type:'organizer_website',is_official:true,validity_status:'valid',published_at:'2026-07-09',last_verified_at:now,final_url:url,evidence_excerpt:'华南农业大学发布2026年正式通知：广东省教育厅主办；学校统一邮件报名，10月8日22:00截止；11月7—8日决赛。'}],
  qualityIssues:['报名开始日期未在当届通知中明确','各校校内选拔截止日期需向所在学校核实','未提供个人直接报名入口；须由参赛高校统一报送'],
  recommendation:{...old.recommendation,missing_information:['报名开始日期未在当届通知中明确','各校校内选拔截止日期需单独核对'],evidence_refs:[url]},aiReview:null};
const current=await call('bootstrap');if(current.stateVersions.records!==state.stateVersions.records||JSON.stringify(current.records.find(x=>x.id===id))!==JSON.stringify(old))throw new Error('concurrent_change');
await call('saveRecords',{records:current.records.map(x=>x.id===id?changed:x),expectedVersion:current.stateVersions.records,auditEntry:{id:`backfill-guangdong-biochem-${Date.now()}`,action:'update',objectType:'event_edition',recordId:id,recordName:old.name,changedFields:['sources','schedule','eligibility','formatAndRules','registrationMethod','qualityIssues'],actor:'super_admin',reason:`按华南农业大学2026年当届正式通知补录；备份：${backupDir}`,createdAt:now}});
const after=await call('bootstrap');const saved=after.records.find(x=>x.id===id);if(!saved||saved.schedule.registration_end!=='2026-10-08'||!saved.sources.some(x=>x.url===url))throw new Error('write_verification_failed');console.log(JSON.stringify({updated:id,status:saved.dataStatus,total:after.records.length,backupDir,verified:true}));
