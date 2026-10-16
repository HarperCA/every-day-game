import Module, {createRequire} from 'node:module';
import {describe,it,expect} from 'vitest';
const require=createRequire(import.meta.url);
let stored={records:[],version:1};
let writes=[];
const db={collection:name=>({doc:id=>({get:async()=>({data:stored}),set:async({data})=>{writes.push({name,id,data});if(name==='admin_state'&&id==='competitions')stored=data},remove:async()=>{writes.push({name,id,removed:true})}})}),runTransaction:async cb=>cb(db)};
const old=Module._load;
Module._load=function(name,...args){return name==='wx-server-sdk'?{init(){},database:()=>db}:old.call(this,name,...args)};
const {runAiReviewPool,runFieldVerificationPool,commitScheduledChanges,selectRequestedReviewRecords}=require('../apps/miniprogram/cloudfunctions/adminData/index.js');
Module._load=old;
const item={id:'edition-test',name:'测试竞赛',dataStatus:'draft',schedule:{registration_start:'2026-10-01',registration_end:'2026-10-30'}};
describe('Kimi disposition scheduler',()=>{
 it('routes a failed review into the agent and returns its final disposition',async()=>{
 const result=await runAiReviewPool([item],1,{runReview:async()=>({decision:'needs_changes'}),resolveFailedCompetition:async()=>({outcome:'delete',record:null,reason:'官网无法确认赛事身份'})});
 expect(result.resolutions.get(item.id).outcome).toBe('delete');expect(result.failures).toEqual([]);
 });
 it('leaves a clean normal field review on the ordinary path',async()=>{
 const result=await runFieldVerificationPool([item],{runReview:async()=>({all_correct:true,name_correct:true,registration_url_correct:true,registration_start_status:'confirmed_correct',registration_end_status:'confirmed_correct',source_scope:'official'}),resolveFailedCompetition:async()=>{throw Error('should not resolve')}});
 expect(result.failures).toEqual([]);expect(result.resolutions.size).toBe(0);expect(result.results.size).toBe(1);
 });
 it('runs the agent directly for an existing failed assessment without buying another ordinary review',async()=>{
 const failed={...item,aiReview:{decision:'insufficient_evidence',reviewed_at:'2026-10-09T00:00:00Z'}};
 const result=await runAiReviewPool([failed],1,{runReview:async()=>{throw Error('ordinary review should not run')},resolveFailedCompetition:async()=>({outcome:'delete',record:null,reason:'代理补查无法核实'})});
 expect(result.resolutions.get(item.id).outcome).toBe('delete');expect(result.failures).toEqual([]);
 });
 it('accepts a kept-draft disposition when independent verification does not fully pass',async()=>{
 const draft={...item,dataStatus:'draft',needsManualReview:true};
 const result=await runAiReviewPool([item],1,{runReview:async()=>({decision:'needs_changes'}),resolveFailedCompetition:async()=>({outcome:'draft',record:draft,reason:'独立复核未通过，留为草稿'})});
 expect(result.resolutions.get(item.id).outcome).toBe('draft');expect(result.failures).toEqual([]);
 });
 it('preserves infrastructure failures instead of deleting records',async()=>{
 const result=await runAiReviewPool([item],1,{runReview:async()=>({decision:'needs_changes'}),resolveFailedCompetition:async()=>{throw Error('network unavailable')}});
 expect(result.resolutions.size).toBe(0);expect(result.results.size).toBe(0);expect(result.failures[0].error).toContain('network');
 });
 it('routes field review failures into the same agent',async()=>{
 const result=await runFieldVerificationPool([item],{runReview:async()=>({all_correct:false}),resolveFailedCompetition:async()=>({outcome:'archived',record:{...item,dataStatus:'archived'},reason:'官方报名已截止'})});
 expect(result.resolutions.get(item.id).outcome).toBe('archived');
 });
 it('atomically stores full deleted record and reason audit',async()=>{
 stored={records:[item],version:1};writes=[];
 const result=await commitScheduledChanges([item],[],new Map([[item.id,{outcome:'delete',record:null,reason:'比赛身份无法核实'}]]),'ai-review');
 expect(result.records).toEqual([]);
 expect(writes.find(x=>x.name==='ai_resolution_backups').data).toMatchObject({record:item,reason:'比赛身份无法核实'});
 expect(writes.find(x=>x.name==='audit_log').data).toMatchObject({action:'delete',reason:'比赛身份无法核实'});
 });
 it('skips results when a person edited the record during the model run',async()=>{
 stored={records:[{...item,name:'人工已修正'}],version:5};writes=[];
 const result=await commitScheduledChanges([item],[],new Map([[item.id,{outcome:'delete',record:null,reason:'过时的判断'}]]),'ai-review');
 expect(result.skipped).toEqual([item.id]);expect(result.records[0].name).toBe('人工已修正');expect(writes.some(x=>x.name==='ai_resolution_backups')).toBe(false);
 });
});


describe('explicit administrator retry selection',()=>{
 it('allows a specified backed-off record without mutating its failure mark',()=>{
 const record={...item,aiReviewFailure:{count:5,lastAt:new Date().toISOString()}};
 expect(selectRequestedReviewRecords([record],'manual',[item.id])).toEqual([record]);
 expect(record.aiReviewFailure.count).toBe(5);
 });
 it('never retries archived or quarantined records',()=>{
 expect(selectRequestedReviewRecords([{...item,dataStatus:'archived'},{...item,id:'q',dataStatus:'quarantined'}],'manual',[item.id,'q'])).toEqual([]);
 });
 it('rejects unbounded or invalid ids and timer overrides',()=>{
 expect(()=>selectRequestedReviewRecords([],'manual',Array.from({length:11},(_,i)=>String(i)))).toThrow('invalid_manual_ai_review_record_ids');
 expect(()=>selectRequestedReviewRecords([],'manual','record')).toThrow('invalid_manual_ai_review_record_ids');
 expect(()=>selectRequestedReviewRecords([],'manual',[null])).toThrow('invalid_manual_ai_review_record_ids');
 expect(()=>selectRequestedReviewRecords([],'timer',['x'])).toThrow('manual_ai_review_retry_required');
 });
 it('preserves normal scheduling with omitted ids and deduplicates specified ids',()=>{
 expect(selectRequestedReviewRecords([item],'manual')).toBeNull();
 expect(selectRequestedReviewRecords([item],'manual',[item.id,item.id])).toEqual([item]);
 });
});


describe('shared in-flight review lock',()=>{
 it('charges only one review when general and field pools request the same record concurrently',async()=>{
 let release;let payments=0;
 const pending=new Promise(resolve=>{release=resolve});
 const general=runAiReviewPool([{...item,dataStatus:'published'}],1,{runReview:async()=>{payments++;await pending;return {decision:'recommend_approve'}}});
 const field=await runFieldVerificationPool([item],{runReview:async()=>{payments++;return {all_correct:true}}});
 expect(field.results.size).toBe(0);expect(field.failures).toEqual([]);expect(field.inFlightSkipped).toEqual([item.id]);
 expect(selectRequestedReviewRecords([item],'manual',[item.id])).toEqual([]);
 release();await general;expect(payments).toBe(1);
 expect(selectRequestedReviewRecords([item],'manual',[item.id])).toEqual([item]);
 });
 it('releases the shared lock after model failure',async()=>{
 await runAiReviewPool([item],1,{runReview:async()=>{throw Error('network failure')}});
 const retry=await runAiReviewPool([{...item,dataStatus:'published'}],1,{runReview:async()=>({decision:'recommend_approve'})});
 expect(retry.results.size).toBe(1);expect(retry.inFlightSkipped).toEqual([]);
 });
});


describe('successful draft disposition',()=>{
 it('sends an approved draft to final independent agent disposition rather than retaining a draft',async()=>{
 let initial;
 const result=await runAiReviewPool([item],1,{runReview:async()=>({decision:'recommend_approve'}),resolveFailedCompetition:async(_record,review)=>{initial=review;return {outcome:'published',record:{...item,dataStatus:'published'},reason:'官方信息已独立复核，发布'}}});
 expect(initial.decision).toBe('recommend_approve');expect(result.resolutions.get(item.id).record.dataStatus).toBe('published');expect(result.failures).toEqual([]);
 });
 it('keeps an already published clean approval on the ordinary review path',async()=>{
 const result=await runAiReviewPool([{...item,dataStatus:'published'}],1,{runReview:async()=>({decision:'recommend_approve'}),resolveFailedCompetition:async()=>{throw Error('not needed')}});
 expect(result.results.size).toBe(1);expect(result.resolutions.size).toBe(0);expect(result.failures).toEqual([]);
 });
});
