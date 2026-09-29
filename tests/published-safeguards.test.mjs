// 2026-09-29：自动任务不再撤下、改动已发布赛事，只打“需人工核对”标记；所有自动改动写审计。
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { applyReviewDisposition } from '../apps/admin/src/reviewDisposition';

const require = createRequire(import.meta.url);
const { isolateMisimport, requireReviewDisposition } = require('../apps/miniprogram/cloudfunctions/adminData/quarantine.js');
const { applyPublishedFieldCorrections } = require('../apps/miniprogram/cloudfunctions/adminData/fieldVerificationIssues.js');
const { autoAudits } = require('../apps/miniprogram/cloudfunctions/adminData/autoAudit.js');
const { buildSafeAuditEntry } = require('../apps/miniprogram/cloudfunctions/adminData/auditValidation.js');

const now = '2026-09-29T08:00:00.000Z';
const identityReview = { decision:'needs_changes', risk_level:'high', issues:[{ field:'event_identity', finding:'下级选拔/赛道，不是独立赛事' }] };
const published = {
  id:'a', name:'安徽省大学生创意设计大赛', dataStatus:'published', manualReview:'passed',
  schedule:{ registration_start:'2026-09-01T00:00:00.000Z', registration_end:'2026-10-07T00:00:00.000Z' },
  registrationUrl:'https://example.org/a', qualityIssues:[],
};

describe('已发布赛事：AI 身份结论只标记，不隔离', () => {
  it('定时审核：保持已发布，打标记写原因，且通过身份处置检查', () => {
    const next = isolateMisimport({ ...published, aiReview:identityReview }, now);
    expect(next.dataStatus).toBe('published');
    expect(next.needsManualReview).toBe(true);
    expect(next.qualityIssues.join()).toContain('下级选拔/赛道');
    expect(() => requireReviewDisposition([published], [next])).not.toThrow();
  });

  it('后台单条审核与定时审核结论一致', () => {
    const client = applyReviewDisposition(published, identityReview, now);
    const server = isolateMisimport({ ...published, aiReview:identityReview }, now);
    expect(client.dataStatus).toBe(server.dataStatus);
    expect(client.qualityIssues).toEqual(server.qualityIssues);
  });

  it('下次审核不再有身份问题时撤掉标记，但保留周检问题', () => {
    const flagged = isolateMisimport({ ...published, aiReview:identityReview }, now);
    const withFieldIssue = { ...flagged, qualityIssues:[...flagged.qualityIssues, '周检：报名截止时间与来源不符'] };
    const cleared = isolateMisimport({ ...withFieldIssue, aiReview:{ decision:'recommend_approve', risk_level:'low', issues:[] } }, now);
    expect(cleared.qualityIssues).toEqual(['周检：报名截止时间与来源不符']);
    expect(cleared.needsManualReview).toBe(true);
    const clean = isolateMisimport({ ...flagged, aiReview:{ decision:'recommend_approve', risk_level:'low', issues:[] } }, now);
    expect(clean.needsManualReview).toBe(false);
  });

  it('草稿照旧隔离', () => {
    expect(isolateMisimport({ ...published, dataStatus:'draft', aiReview:identityReview }, now).dataStatus).toBe('quarantined');
  });
});

describe('已发布赛事：周检只提建议，不改线上字段', () => {
  const verification = {
    name_correct:false, name_correction:'黄山学院校赛',
    registration_start_status:'confirmed_correct', registration_end_status:'incorrect', registration_end_correction:'2026-09-30',
    registration_url_correct:false, registration_url_correction:'https://school.edu.cn/notice',
  };
  it('名称、截止日、链接都不改，修正值写进问题并标记人工核对', () => {
    const next = applyPublishedFieldCorrections(published, verification, new Date(now));
    expect(next.name).toBe(published.name);
    expect(next.schedule).toEqual(published.schedule);
    expect(next.registrationUrl).toBe(published.registrationUrl);
    expect(next.needsManualReview).toBe(true);
    expect(next.qualityIssues.some(item => item.includes('2026-09-30') && item.includes('未自动修改'))).toBe(true);
  });
  it('周检全部通过也不会清掉 AI 身份标记', () => {
    const flagged = { ...published, needsManualReview:true, qualityIssues:['AI身份审核：下级选拔/赛道，不是独立赛事（已发布记录不自动隔离，请人工核对）'] };
    const ok = { name_correct:true, registration_start_status:'confirmed_correct', registration_end_status:'confirmed_correct', registration_url_correct:true };
    const next = applyPublishedFieldCorrections(flagged, ok, new Date(now));
    expect(next.needsManualReview).toBe(true);
    expect(next.qualityIssues).toEqual(flagged.qualityIssues);
  });
});

describe('自动任务的审计日志', () => {
  it('关键字段变化逐条记下操作人、改了什么和原因', () => {
    const quarantined = { ...published, dataStatus:'quarantined', quarantine:{ reason:'下级选拔/赛道，不是独立赛事' } };
    const archived = { ...published, id:'b', dataStatus:'archived' };
    const [q, a] = autoAudits([published, { ...published, id:'b' }], [quarantined, archived], 'ai-review', new Date(now));
    expect(q.systemActor).toBe('ai-review');
    expect(q.changedFields).toEqual(['dataStatus']);
    expect(q.reason).toBe('状态 已发布 → 隔离。原因：下级选拔/赛道，不是独立赛事');
    expect(a.action).toBe('archive');
    expect(a.reason).toContain('报名截止 2026-10-07 已过');
    const saved = buildSafeAuditEntry(q, { systemActor:q.systemActor });
    expect(saved.actor_id).toBe('ai-review');
    expect(saved.before.dataStatus).toBe('published');
    expect(saved.after.dataStatus).toBe('quarantined');
  });
  it('只刷新 AI 审核意见不记审计；后台提交的审计不能冒充自动任务', () => {
    expect(autoAudits([published], [{ ...published, aiReview:identityReview }], 'ai-review', new Date(now))).toEqual([]);
    expect(buildSafeAuditEntry({ id:'x', action:'update', recordId:'a', createdAt:now, systemActor:'ai-review' }).actor_id).toBe('super_admin');
    expect(() => autoAudits([], [], 'someone')).toThrow();
  });
});
