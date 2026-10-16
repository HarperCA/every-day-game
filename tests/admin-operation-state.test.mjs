import {createRequire, Module} from 'node:module';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {openDatabase} from '../apps/server/src/db.mjs';
import {createCloudShim} from '../apps/server/src/cloudbase-shim.mjs';
const require=createRequire(import.meta.url);
const path=require.resolve('../apps/miniprogram/cloudfunctions/adminData/index.js');
const audit={id:'audit-1',action:'feedback_accept',objectType:'feedback',recordId:'feedback-1',recordName:'赛事',changedFields:['status'],createdAt:'2026-10-13T00:00:00Z'};
function setup() {
  const sqlite=openDatabase(':memory:');
  const db=createCloudShim(sqlite).database();
  const previous=Module._load;
  delete require.cache[path];
  Module._load=function(name,...args){return name==='wx-server-sdk'?{init(){},database:()=>db,getWXContext:()=>({})}:previous.call(this,name,...args);};
  let main;
  try {main=require(path).main;} finally {Module._load=previous;}
  return {sqlite,db,main};
}
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();delete require.cache[path];});
describe('atomic administrator operation persistence',()=>{
  it('rolls back state and audit when a submitted feedback update fails',async()=>{
    const {sqlite,db,main}=setup();
    vi.stubEnv('ADMIN_TOKEN','test-token');vi.spyOn(console,'error').mockImplementation(()=>undefined);
    try {
      await db.collection('admin_state').doc('feedbacks').set({data:{records:[],version:0}});
      const result=await main({action:'saveOperationState',adminToken:'test-token',feedbacks:[{id:'missing',source:'user_submission'}],submittedUpdates:[{id:'missing',source:'user_submission',status:'accepted',category:'time',content:'错'}],auditEntries:[audit],expectedVersions:{feedbacks:0}});
      expect(result.ok).toBe(false);
      expect((await db.collection('admin_state').doc('feedbacks').get()).data).toMatchObject({records:[],version:0});
      expect((await db.collection('audit_log').get()).data).toEqual([]);
    } finally {sqlite.close();}
  });
  it('commits feedback, AI queue and audit together and rejects a stale version',async()=>{
    const {sqlite,db,main}=setup();
    vi.stubEnv('ADMIN_TOKEN','test-token');vi.spyOn(console,'error').mockImplementation(()=>undefined);
    try {
      const input={action:'saveOperationState',adminToken:'test-token',feedbacks:[{id:'feedback-1',status:'ai_queued'}],aiJobs:[{id:'job-1',status:'queued'}],auditEntries:[audit],expectedVersions:{feedbacks:0,aiJobs:0}};
      expect(await main(input)).toMatchObject({ok:true,data:{versions:{feedbacks:1,aiJobs:1}}});
      expect((await db.collection('admin_state').doc('ai_jobs').get()).data.records).toEqual(input.aiJobs);
      expect((await db.collection('audit_log').get()).data).toHaveLength(1);
      expect(await main({...input,feedbacks:[],aiJobs:[]})).toMatchObject({ok:false,message:'state_version_conflict:feedbacks:1'});
      expect((await db.collection('admin_state').doc('ai_jobs').get()).data.records).toEqual(input.aiJobs);
    } finally {sqlite.close();}
  });
});
