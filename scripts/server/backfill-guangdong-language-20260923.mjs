// 补录广东省大学生外语能力大赛当届省赛通知，撤销“仅有目录”隔离；默认预览。
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));const token=(await fs.readFile(path.join(here,'.admin-token'),'utf8')).trim();
const id='edition-guangdong-no5',url='https://zhjw.jnu.edu.cn/2026/0720/c7164a860731/page.htm',entry='https://ucc.fltrp.com/';
async function call(action,data={}){const r=await fetch('http://127.0.0.1:8787/api/adminData',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({adminToken:token,action,...data})});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.message||`HTTP ${r.status}`);return j.data}
const state=await call('bootstrap');const matches=state.records.filter(x=>x.id===id);if(matches.length!==1)throw new Error('target_not_unique');const old=matches[0];
if(old.dataStatus!=='quarantined'||old.quarantine?.reason!=='来源标题为竞赛立项及承办单位名单清单，非赛事条目，需隔离为线索'||old.sources?.length!==1||old.registrationUrl)throw new Error('target_changed');
const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(15000)});const html=await r.text();if(r.status!==200||r.url!==url||!html.includes('2026年广东省大学生外语能力大赛')||!html.includes(entry))throw new Error('official_page_changed');
console.log(JSON.stringify({version:state.stateVersions.records,id,name:old.name,officialUrl:url,finalUrl:r.url,entry,openBranches:'综合能力、演讲、笔译；以所在高校校赛安排为准',branchDeadlines:'演讲10月8日、综合能力和笔译10月17日由学校报送'},null,2));
if(!process.argv.includes('--apply'))process.exit(0);if(process.argv[process.argv.indexOf('--expect-version')+1]!==String(state.stateVersions.records))throw new Error('preview_changed');
const backupDir=path.join(here,'backups',`guangdong-language-backfill-${new Date().toISOString().replace(/[:.]/g,'-')}`);await fs.mkdir(backupDir,{recursive:true,mode:0o700});await fs.writeFile(path.join(backupDir,'records-before.json'),JSON.stringify(state,null,2),{mode:0o600});
const now=new Date().toISOString();const changed={...old,
  organizer:'广东省教育厅（主办）／暨南大学（承办）',
  participants:'广东省普通高校全日制本科生、硕士研究生；英语组含来华留学生，多语种组按赛项资格，国际中文组面向来华留学生及进修生。',
  eligibility:'参赛者须以所在高校为单位参加校赛并由学校统一报送省赛；各语种、赛项资格和名额以当届省赛通知为准。',
  formatAndRules:'设英语组、多语种组和国际中文组。英语组含综合能力、演讲、笔译、短视频及“四新”专项；各赛项有不同的校赛、报送及省赛时间，详见暨南大学发布的当届省赛通知。',
  registrationMethod:'选手在大赛官网注册报名；晋级省赛名单由所在高校校赛管理员在官网统一填报，个人直接报送省赛不予受理。',
  registrationOrganization:'参赛高校统一报送省赛',registrationUrl:entry,
  lastVerifiedAt:now,updatedAt:now,updatedBy:'manual-official-source-backfill',dataStatus:'draft',
  schedule:{...old.schedule,pending_announcement:false,time_note:'各赛项截止日不同：短视频、“四新”、多语种等9月21日已截止；演讲省赛名单由学校于10月8日前报送，综合能力及笔译于10月17日前报送。校内选拔截止日以所在高校通知为准，不设置统一报名截止日。'},
  sources:[...old.sources,{id:'source-guangdong-no5-2026-host-notice',edition_id:id,url,source_type:'organizer_website',is_official:true,validity_status:'valid',published_at:'2026-07-20',last_verified_at:now,final_url:url,evidence_excerpt:'暨南大学发布2026年广东省大学生外语能力大赛省赛通知：广东省教育厅主办；官网注册、学校统一报送；演讲10月8日、综合能力和笔译10月17日前报送，部分赛项9月21日已截止。'}],
  qualityIssues:['各赛项及各校校内选拔截止日不同，不得显示统一报名截止时间','短视频、“四新”、多语种等赛项的报名/报送节点已过','参赛资格须经所在学校校赛确认'],
  recommendation:{...old.recommendation,missing_information:['各校校内选拔截止日须向所在学校核对'],evidence_refs:[url,entry]},aiReview:null};
delete changed.quarantine;
const current=await call('bootstrap');if(current.stateVersions.records!==state.stateVersions.records||JSON.stringify(current.records.find(x=>x.id===id))!==JSON.stringify(old))throw new Error('concurrent_change');
await call('saveRecords',{records:current.records.map(x=>x.id===id?changed:x),expectedVersion:current.stateVersions.records,auditEntry:{id:`backfill-guangdong-language-${Date.now()}`,action:'update',objectType:'event_edition',recordId:id,recordName:old.name,changedFields:['sources','dataStatus','registrationUrl','registrationMethod','schedule','qualityIssues'],actor:'super_admin',reason:`暨南大学2026年省赛正式通知已证实赛事；撤销仅因目录线索作出的隔离。备份：${backupDir}`,createdAt:now}});
const after=await call('bootstrap');const saved=after.records.find(x=>x.id===id);if(!saved||saved.dataStatus!=='draft'||saved.registrationUrl!==entry||!saved.sources.some(x=>x.url===url))throw new Error('write_verification_failed');console.log(JSON.stringify({updated:id,status:saved.dataStatus,total:after.records.length,backupDir,verified:true}));
