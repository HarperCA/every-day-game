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
  it('拦截手动新增及发布名称含“通知”的条目，但不误伤证据中的通知', () => {
    expect(getSystemReviewIssues({...validRecord, name:'测试竞赛通知'})).toContain('名称含“通知”的条目只能作为线索，不得入赛事库');
    expect(getPublishBlockers({...validRecord, name:'测试竞赛通知', systemValidation:'passed', manualReview:'passed'})).toContain('通知线索尚未解析为赛事');
    expect(getSystemReviewIssues({...validRecord, formatAndRules:'以官方通知为准'})).toEqual([]);
  });
  it('拦截感叹号及“正式启动”类标题', () => {
    const headline = {...validRecord, name:'测试竞赛正式启动！', systemValidation:'passed', manualReview:'passed'};
    expect(getSystemReviewIssues(headline)).toContain('名称含感叹号或活动报道用语，不得入赛事库');
    expect(getPublishBlockers(headline)).toContain('名称含感叹号或活动报道用语');
  });
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

  it('requires system validation to actually pass, not just human approval — must match the server gate', () => {
    // 服务器 publicCache.js 的 requirePublishGate 是严格 AND：人工审核通过不能
    // 豁免系统验证。之前这里放行过"人工审核通过就够了"，导致后台"发布"按钮
    // 显示可点、点了却被服务器拒绝保存——界面看着像发布成功，小程序其实什么
    // 都没收到。两边口径必须一致，这里就是防止再退回那个状态的回归测试。
    expect(isPublishReady(validRecord)).toBe(false);
    expect(isPublishReady({ ...validRecord, systemValidation: 'failed', manualReview: 'pending' })).toBe(false);
    const humanReviewedOnly = { ...validRecord, systemValidation: 'not_run', manualReview: 'passed' };
    expect(getPublishBlockers(humanReviewedOnly)).toEqual(['系统验证未通过']);
    expect(isPublishReady(humanReviewedOnly)).toBe(false);
    expect(() => publishRecord(humanReviewedOnly, '2026-08-21T01:30:00.000Z')).toThrow();

    const reviewed = { ...validRecord, systemValidation: 'passed', manualReview: 'passed' };
    expect(getPublishBlockers(reviewed)).toEqual([]);
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
