import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { resolveFailedCompetition } = require('../apps/miniprogram/cloudfunctions/adminData/kimiReviewDisposition.js');
const now = '2026-10-09T04:00:00Z';
const record = { id:'edition-one', eventId:'event-one', name:'大学生计算机设计竞赛', editionName:'2026届', editionYear:'2026', organizer:'计算机学会', participants:'在校大学生', eligibility:'大学生', formatAndRules:'计算机软件编程作品设计评审', professions:['计算机与AI'], registrationUrl:'https://official.example/register', dataStatus:'draft', schedule:{registration_start:'2026-09-01',registration_end:'2026-10-20'}, sources:[] };
const source = { url:'https://official.example/notice',source_type:'organizer_notice',is_official:true,validity_status:'valid',last_verified_at:now,evidence_excerpt:'大学生计算机软件编程设计竞赛，9月1日报名，10月20日截止',supports_fields:['name','registration_start','registration_end'] };
const verify = { name_correct:true,registration_url_correct:true,registration_start_status:'confirmed_correct',registration_end_status:'confirmed_correct',source_scope:'official',professions_confident:true,professions:['计算机与AI'],evidence_status:[{url:source.url,status:'reachable',chars:200}] };
const agent = { outcome:'resolved',reason:'查到官方通知',recordPatch:{sources:[source]},evidence:[{url:source.url,status:'reachable',text:source.evidence_excerpt}],tool_calls:[] };
const deps = { runAgent:async()=>agent,verify:async()=>verify };
const run = (item=record, dependencies=deps, options={}) => resolveFailedCompetition(item,{decision:'needs_changes'},{now,...options},dependencies);
describe('failed Kimi review final disposition',()=>{
  it('publishes only after independent verification and supplies auditable reason',async()=>{
    const result=await run({...record,aiResolutionFailure:{error:'previous timeout'}});
    expect(result.outcome).toBe('published');
    expect(result.record.sources[0].id).toContain('resolution');
    expect(result.record.aiResolution.initial_review.decision).toBe('needs_changes');
    expect(result.record.aiReview.decision).toBe('recommend_approve');
    expect(result.record.aiResolutionFailure).toBeUndefined();
  });
  it('archives a genuinely elapsed deadline',async()=>{
    expect((await run({...record,schedule:{...record.schedule,registration_end:'2026-10-08'}})).outcome).toBe('archived');
  });
  it('does not archive at the start of a Chinese whole-date deadline',async()=>{
    expect((await run({...record,schedule:{...record.schedule,registration_end:'2026-10-09'}})).outcome).toBe('published');
  });
  it('keeps a draft with the failed check instead of deleting when the verifier doubts the official source',async()=>{
    const result=await run({...record,dataStatus:'published',aiReviewFailure:{count:1}},{...deps,verify:async()=>({...verify,source_scope:'school_notice'})});
    expect(result.outcome).toBe('draft');expect(result.record.dataStatus).toBe('draft');
    expect(result.record.needsManualReview).toBe(true);expect(result.record.manualReview).toBe('pending');
    expect(result.reason).toContain('官方来源');expect(result.record.qualityIssues).toContain('独立复核未通过：独立复核未确认赛事官方来源');
    expect(result.record.aiResolution).toMatchObject({outcome:'draft',failed_checks:['独立复核未确认赛事官方来源']});
    expect(result.record.aiReviewFailure).toBeUndefined();
  });
  it('does not accept unspecified dates when a candidate retains invented dates',async()=>{
    const result=await run(record,{...deps,verify:async()=>({...verify,registration_start_status:'not_specified'})});
    expect(result.outcome).toBe('draft');expect(result.reason).toContain('报名开始时间未通过独立复核');
  });
  it('preserves records on provider infrastructure failure by throwing',async()=>{
    await expect(run(record,{...deps,verify:async()=>{throw new Error('provider timeout')}})).rejects.toThrow('timeout');
    expect(record.dataStatus).toBe('draft');
  });
  it('returns agent deletion without pretending a successful field verification',async()=>{
    const result=await run(record,{runAgent:async()=>({...agent,outcome:'delete',reason:'官方网站确认不是独立赛事'}),verify:async()=>{throw new Error('should not call')}});
    expect(result.reason).toBe('官方网站确认不是独立赛事');
  });
  it('rejects reversed dates even when model claims dates are correct',async()=>{
    expect((await run({...record,schedule:{registration_start:'2026-11-01',registration_end:'2026-10-10'}})).reason).toContain('晚于');
  });
  it('rejects duplicate corrected editions',async()=>{
    expect((await run(record,deps,{records:[{...record,id:'already-published',dataStatus:'published'}]})).reason).toContain('重复');
  });
  it('does not downgrade official evidence gate for archived records',async()=>{
    const result=await run({...record,schedule:{...record.schedule,registration_end:'2026-10-08'}},{...deps,runAgent:async()=>({...agent,recordPatch:{sources:[{...source,supports_fields:[]}]}})});
    expect(result.outcome).toBe('delete');expect(result.reason).toContain('official_source');
  });
  it('does not delete on inaccessible fresh verification sources',async()=>{
    await expect(run(record,{...deps,verify:async()=>({...verify,evidence_status:[{url:source.url,status:'http_403',chars:0}]})})).rejects.toThrow('evidence_unavailable');
  });
  it('clears old notice pending only once official identity is independently confirmed',async()=>{
    const result=await run({...record,qualityIssues:['notice_resolution_pending','other_warning']});
    expect(result.outcome).toBe('published');expect(result.record.qualityIssues).toEqual(['other_warning']);
  });
  it('keeps genuine competitions while downgrading invalid filter enums',async()=>{
    const result=await run({...record,eventLevel:'国家比赛',participationFormat:'个人赛',teamSizeCategory:'2人',feeType:'免费',registrationOrganization:'自行报名'});
    expect(result.outcome).toBe('published');
    expect(result.record.eventLevel).toBe('其他/未明确');
    expect(result.record.participationFormat).toBe('暂未明确');
    expect(result.record.teamSizeCategory).toBe('暂未明确');
    expect(result.record.feeType).toBe('暂未公布');
    expect(result.record.registrationOrganization).toBe('暂未明确');
    expect(result.record.aiResolution.filter_adjustments).toHaveLength(5);
  });
  it('retains explicit mappings only with verbatim official supporting originals',async()=>{
    const text='全国大学生比赛；参赛队伍由2至3人组成；免收报名费；参赛者通过官网自行报名';
    const result=await run({...record,eventLevel:'国家级',participationFormat:'团队赛',teamSizeCategory:'2～3人',teamSize:'参赛队伍由2至3人组成',feeType:'免费',fees:'免收报名费',registrationOrganization:'自行报名',registrationMethod:'参赛者通过官网自行报名'},
      {...deps,runAgent:async()=>({...agent,evidence:[{url:source.url,status:'reachable',text}],recordPatch:{sources:[{...source,evidence_excerpt:text,supports_fields:['eventLevel']}]}})});
    expect(result.outcome).toBe('published');expect(result.record.eventLevel).toBe('国家级');expect(result.record.feeType).toBe('免费');expect(result.record.teamSizeCategory).toBe('2～3人');
  });
  it('does not publish or delete when the final verifier has no readable evidence',async()=>{
    await expect(run(record,{...deps,verify:async()=>({...verify,evidence_status:[]})})).rejects.toThrow('manual_evidence_required');
    await expect(run(record,{...deps,verify:async()=>({...verify,evidence_status:undefined})})).rejects.toThrow('independent_evidence_required');
  });
  it('downgrades contradictory mappings even if the original is real',async()=>{
    const text='参赛队伍由4至5人组成；报名费100元';
    const result=await run({...record,participationFormat:'个人赛',teamSizeCategory:'2～3人',teamSize:'参赛队伍由4至5人组成',feeType:'免费',fees:'报名费100元'},
      {...deps,runAgent:async()=>({...agent,evidence:[{url:source.url,status:'reachable',text}]})});
    expect(result.outcome).toBe('published');expect(result.record.teamSizeCategory).toBe('暂未明确');expect(result.record.feeType).toBe('暂未公布');expect(result.record.participationFormat).toBe('暂未明确');
  });
  it('normalizes invented midnight before verification on date-only announcements',async()=>{
    let seen;
    const result=await run({...record,schedule:{registration_start:'2026-09-01T00:00:00+08:00',registration_end:'2026-10-09T00:00:00+08:00',time_note:'报名日期已公布，未公布具体时刻'}},
      {...deps,verify:async item=>{seen=item.schedule;return verify;}});
    expect(seen.registration_start).toBe('2026-09-01');expect(seen.registration_end).toBe('2026-10-09');expect(result.outcome).toBe('published');
  });
  it('retains announced midnight and other explicit times',async()=>{
    const result=await run({...record,schedule:{registration_start:'2026-09-01T00:00:00+08:00',registration_end:'2026-10-09T00:00:00+08:00',time_note:'明确为午夜截止'}});
    expect(result.record.schedule.registration_end).toBe('2026-10-09T00:00:00+08:00');expect(result.outcome).toBe('archived');
    const daytime=await run({...record,schedule:{...record.schedule,registration_end:'2026-10-09T18:00:00+08:00',time_note:'未公布具体时刻'}});
    expect(daytime.record.schedule.registration_end).toBe('2026-10-09T18:00:00+08:00');
  });
  it('does not normalize midnight without an explicit date-only note',async()=>{
    const result=await run({...record,schedule:{...record.schedule,registration_end:'2026-10-09T00:00:00+08:00'}});
    expect(result.record.schedule.registration_end).toBe('2026-10-09T00:00:00+08:00');expect(result.outcome).toBe('archived');
  });
});
