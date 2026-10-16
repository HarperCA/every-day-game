import { beforeEach, describe, expect, it } from 'vitest';
import { appendAuditEntry, loadAuditEntries } from '../apps/admin/src/dataStore';
import { changedOperationFields, hydrateOperationStores, loadAiJobs, loadFeedbacks, persistAiJobs, persistFeedbacks, validateAiJobRecord, validateFeedbackRecord } from '../apps/admin/src/operationsStore';

const values = new Map<string,string>();

beforeEach(() => {
  values.clear();
  (globalThis as any).window = {
    localStorage: {
      getItem: (key:string) => values.get(key) || null,
      setItem: (key:string,value:string) => values.set(key,value),
      removeItem: (key:string) => values.delete(key),
    },
  };
});

describe('admin operation stores', () => {
  it('keeps server empty feedback and AI queues empty after login',()=>{
    expect(loadFeedbacks().length).toBeGreaterThan(0);
    hydrateOperationStores([],[]);
    expect(loadFeedbacks()).toEqual([]);
    expect(loadAiJobs()).toEqual([]);
  });
  it('persists feedback review state', () => {
    const feedbacks = loadFeedbacks();
    expect(feedbacks.some(item=>item.status==='ai_passed')).toBe(true);
    expect(feedbacks.some(item=>item.status==='ai_flagged')).toBe(true);
    persistFeedbacks(feedbacks.map((item,index)=>index===0?{...item,status:'accepted' as const}:item));
    expect(loadFeedbacks()[0].status).toBe('accepted');
  });

  it('persists AI retry queue state without claiming success', () => {
    const jobs = loadAiJobs();
    expect(jobs.some(item=>item.jobType==='feedback_review')).toBe(true);
    persistAiJobs(jobs.map((item,index)=>index===0?{...item,status:'queued' as const,retryCount:item.retryCount+1}:item));
    expect(loadAiJobs()[0].status).toBe('queued');
    expect(loadAiJobs()[0].retryCount).toBe(1);
  });

  it('records feedback and AI actions in the same audit log', () => {
    appendAuditEntry({action:'feedback_accept',objectType:'feedback',recordId:'feedback-1',recordName:'测试纠错',changedFields:['status'],actor:'admin'});
    appendAuditEntry({action:'ai_job_retry',objectType:'ai_job',recordId:'job-1',recordName:'测试任务',changedFields:['retry_count'],actor:'admin'});
    expect(loadAuditEntries().map(item=>item.action)).toEqual(['ai_job_retry','feedback_accept']);
  });

  it('validates direct feedback edits and reports only changed fields', () => {
    const original = loadFeedbacks()[0];
    const edited = { ...original, content:'报名截止时间应以赛区最新通知为准。', evidenceUrl:'https://example.com/notice' };
    expect(validateFeedbackRecord(edited)).toEqual([]);
    expect(changedOperationFields(original,edited,['content','evidenceUrl','status'])).toEqual(['content','evidenceUrl']);
    expect(validateFeedbackRecord({...edited,content:'短'})).toEqual([]);
    expect(validateFeedbackRecord({ ...edited, content:' ', evidenceUrl:'invalid' })).toEqual(expect.arrayContaining(['纠错内容不能为空','证据链接必须以 http:// 或 https:// 开头']));
  });

  it('validates editable AI retry configuration before persistence', () => {
    const original = loadAiJobs()[0];
    const edited = { ...original, provider:'OpenAI', model:'gpt-test', maxRetries:5 };
    expect(validateAiJobRecord(edited)).toEqual([]);
    persistAiJobs([edited]);
    expect(loadAiJobs()[0]).toMatchObject({ provider:'OpenAI', model:'gpt-test', maxRetries:5 });
    expect(validateAiJobRecord({ ...edited, retryCount:6, maxRetries:5 })).toContain('已重试次数不能大于最大重试次数');
  });
});
