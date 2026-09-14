import { describe, expect, it } from 'vitest';
import { buildProfessionCatalog, getPublishBlockers, getSystemReviewIssues, isPublishReady, normalizeProfessions, publishRecord, runSystemReview, runSystemReviewBatch, unpublishRecord } from '../apps/admin/src/adminWorkflow';

const validRecord = {
  id: 'competition-1',
  name: '测试竞赛',
  editionName: '测试竞赛（2026）',
  participationFormat: '团队赛',
  teamSizeCategory: '2～3人',
  teamSize: '每队2—3人',
  feeType: '免费',
  fees: '不收取报名费',
  registrationOrganization: '自行报名',
  registrationMethod: '参赛者通过官网报名',
  registrationUrl: 'https://example.com/register',
  lastVerifiedAt: '2026-08-21T00:00:00.000Z',
  professions: ['计算机与AI'],
  qualityIssues: [],
  sources: [{ is_official: true, url: 'https://example.com/notice', validity_status:'valid' }],
  systemValidation: 'not_run',
  manualReview: 'pending',
  recommendation: { published_cache: false },
};

describe('admin review and publish workflow', () => {
  it('runs deterministic system review and exposes data issues', () => {
    expect(getSystemReviewIssues(validRecord)).toEqual([]);
    expect(runSystemReview(validRecord, '2026-08-21T01:00:00.000Z')).toMatchObject({
      systemValidation: 'passed',
      dataStatus: 'pending_manual_review',
      systemReviewIssues: [],
    });
    expect(getSystemReviewIssues({ ...validRecord, registrationUrl: '', qualityIssues: ['source_reachability_not_checked'] }))
      .toEqual(expect.arrayContaining(['报名链接缺失或格式不正确', '来源链接尚未核验可访问性']));
  });

  it('allows the highest-priority human approval to publish directly', () => {
    expect(isPublishReady(validRecord)).toBe(false);
    expect(isPublishReady({ ...validRecord, systemValidation: 'failed', manualReview: 'pending' })).toBe(false);
    const humanReviewed = { ...validRecord, systemValidation: 'not_run', manualReview: 'passed' };
    expect(getPublishBlockers(humanReviewed)).toEqual([]);
    expect(isPublishReady(humanReviewed)).toBe(true);
    expect(publishRecord(humanReviewed, '2026-08-21T01:30:00.000Z')).toMatchObject({ dataStatus:'published' });

    const reviewed = { ...validRecord, systemValidation: 'passed', manualReview: 'passed' };
    expect(isPublishReady(reviewed)).toBe(true);
    expect(publishRecord(reviewed, '2026-08-21T02:00:00.000Z')).toMatchObject({ dataStatus: 'published', publishedAt: '2026-08-21T02:00:00.000Z' });
    expect(unpublishRecord({ ...reviewed, dataStatus: 'published' }, '2026-08-21T03:00:00.000Z')).toMatchObject({ dataStatus: 'offline', offlineAt: '2026-08-21T03:00:00.000Z' });
  });

  it('reviews every unpublished record in one batch and skips published data', () => {
    const result = runSystemReviewBatch([
      validRecord,
      { ...validRecord, id: 'competition-2', registrationUrl: '', qualityIssues: ['source_reachability_not_checked'] },
      { ...validRecord, id: 'competition-3', dataStatus: 'published', systemValidation: 'passed', manualReview: 'passed' },
    ], '2026-08-21T04:00:00.000Z');
    expect(result).toMatchObject({ passed: 1, flagged: 1, skipped: 1, reviewedIds: ['competition-1', 'competition-2'] });
    expect(result.records[0].systemValidation).toBe('passed');
    expect(result.records[1].systemValidation).toBe('failed');
    expect(result.records[2].dataStatus).toBe('published');
  });

  it('builds and normalizes a stable profession catalog', () => {
    expect(buildProfessionCatalog([{ professions: ['电子信息', '计算机与AI'] }, { professions: ['计算机与AI'] }])).toEqual(['电子信息', '计算机与AI']);
    expect(normalizeProfessions([' 计算机与AI ', '', '计算机与AI', '经管与商科'])).toEqual(['计算机与AI', '经管与商科']);
  });
});
