import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { prepareQuarantineRecovery } from '../apps/admin/src/quarantineRecovery';
const require = createRequire(import.meta.url);
const { requireQuarantineRecovery } = require('../apps/miniprogram/cloudfunctions/adminData/quarantine.js');
const { requireScopeForNewRecords } = require('../apps/miniprogram/cloudfunctions/adminData/competitionScope.js');
const { toPublicCache } = require('../apps/miniprogram/cloudfunctions/adminData/publicCache.js');

const now = new Date('2026-09-24T12:00:00Z');
function sample(end = '2026-10-10T12:00:00+08:00') {
  return {
    id:'edition-test-2026',eventId:'event-test',name:'全国大学生程序设计竞赛',editionName:'2026年全国大学生程序设计竞赛',
    editionYear:'2026',editionOrdinal:'',organizer:'中国计算机学会',participants:'全国高校本科生',eligibility:'在校本科生',
    formatAndRules:'算法编程与系统设计',professions:['计算机与AI'],eventLevel:'国家级',
    participationFormat:'个人赛',teamSizeCategory:'1人',teamSize:'1人',feeType:'暂未公布',
    registrationOrganization:'自行报名',registrationMethod:'官网在线报名',
    registrationUrl:'https://contest.example/register',lastVerifiedAt:'2026-09-24T11:00:00Z',
    schedule:{registration_start:'2026-09-01T00:00:00+08:00',registration_end:end},
    sources:[{id:'source-1',source_type:'organizer_website',url:'https://contest.example/2026',is_official:true,validity_status:'valid'}],
    qualityIssues:[],systemValidation:'not_run',manualReview:'pending',dataStatus:'quarantined',
    recommendation:{system_validation:'not_run',manual_review:'pending',published_cache:false},
    quarantine:{at:'2026-09-20T00:00:00Z',reason:'旧自动判断有疑问',previousStatus:'draft'},
  };
}

it('隔离记录可以人工恢复草稿，审核状态重新开始且原隔离原因保留',()=>{
  const old = sample();
  const next = prepareQuarantineRecovery(old,'draft',now);
  expect(next.dataStatus).toBe('draft');
  expect(next.quarantine.reason).toBe(old.quarantine.reason);
  expect(next.manualReview).toBe('pending');
  expect(()=>requireScopeForNewRecords([old],[next])).not.toThrow();
  expect(()=>requireQuarantineRecovery([old],[next],now)).not.toThrow();
});

it('资料和审核门槛满足时可直接发布，并保留人工处置依据',()=>{
  const old = sample();
  const next = prepareQuarantineRecovery(old,'published',now);
  expect(next.systemValidation).toBe('passed');
  expect(next.manualReview).toBe('passed');
  expect(next.quarantineResolution.to).toBe('published');
  expect(()=>requireScopeForNewRecords([old],[next])).not.toThrow();
  expect(()=>requireQuarantineRecovery([old],[next],now)).not.toThrow();
  expect(toPublicCache(next,now).data_status).toBe('published');
});

it('截止后可人工归档，但不能发布；无已核验官方来源不能归档',()=>{
  const old = sample('2026-09-01T12:00:00+08:00');
  expect(()=>prepareQuarantineRecovery(old,'published',now)).toThrow('报名已截止');
  const archived = prepareQuarantineRecovery(old,'archived',now);
  expect(()=>requireScopeForNewRecords([old],[archived])).not.toThrow();
  expect(()=>requireQuarantineRecovery([old],[archived],now)).not.toThrow();
  expect(toPublicCache(archived,now).data_status).toBe('archived');
  expect(()=>requireQuarantineRecovery([old],[{...archived,sources:archived.sources.map(source=>({...source,validity_status:'unchecked'}))}],now)).toThrow('官方来源');
});

it('通知标题即使点人工发布也不能从隔离区直接进入比赛库',()=>{
  const old = sample();
  const next = {...prepareQuarantineRecovery(old,'published',now), name:'关于全国大学生程序设计竞赛的通知'};
  expect(()=>requireScopeForNewRecords([old],[next])).toThrow('赛事范围未通过');
});

it('不能通过改状态或沿用隔离前审核结论绕过人工处置',()=>{
  const old = sample();
  const published = prepareQuarantineRecovery(old,'published',now);
  expect(()=>requireQuarantineRecovery([old],[{...published,quarantineResolution:null}],now)).toThrow('人工处置记录');
  expect(()=>requireQuarantineRecovery([old],[{...published,manualReviewedAt:'2026-09-01T00:00:00Z'}],now)).toThrow('重新完成');
});
