import { validateAdminRecord } from './validation';

export const workflowStatusLabels: Record<string, string> = {
  not_run: '未执行',
  pending: '待审核',
  passed: '已通过',
  failed: '有问题',
  rejected: '已退回',
};

export const qualityIssueLabels: Record<string, string> = {
  source_reachability_not_checked: '来源链接尚未核验可访问性',
  track_requires_official_split: '组合赛项需按官方资料拆分',
  registration_time_pending: '报名时间待官方确认',
  registration_url_pending: '报名入口待官方确认',
  source_missing: '缺少官方数据来源',
  profession_mapping_pending: '适合专业待人工确认',
};

export function getSystemReviewIssues(record: any): string[] {
  const issues = [...validateAdminRecord(record)];
  if (!/^https?:\/\//i.test(record.registrationUrl || '')) issues.push('报名链接缺失或格式不正确');
  if (!record.lastVerifiedAt) issues.push('缺少最后核验时间');
  if (!(record.sources || []).some((source: any) => source.is_official && /^https?:\/\//i.test(source.url || ''))) {
    issues.push('缺少有效格式的官方来源链接');
  }
  if (!Array.isArray(record.professions) || !record.professions.length) issues.push('尚未配置适合专业');
  for (const issue of record.qualityIssues || []) {
    issues.push(qualityIssueLabels[issue] || `待处理：${issue}`);
  }
  return Array.from(new Set(issues));
}

export function getPublishBlockers(record: any): string[] {
  if (record.manualReview === 'passed') return [];
  const blockers: string[] = [];
  if (record.systemValidation !== 'passed') blockers.push('系统验证未通过');
  if (record.manualReview !== 'passed') blockers.push('人工审核未通过');
  if (!/^https?:\/\//i.test(record.registrationUrl || '')) blockers.push('报名链接不可用');
  if (!record.lastVerifiedAt) blockers.push('缺少最后核验时间');
  if (!Array.isArray(record.professions) || !record.professions.length) blockers.push('适合专业未映射');
  if (!(record.sources || []).some((source: any) => source.is_official && source.validity_status === 'valid' && /^https?:\/\//i.test(source.url || ''))) blockers.push('缺少已核验有效的官方来源');
  return blockers;
}

export function isPublishReady(record: any): boolean {
  return getPublishBlockers(record).length === 0;
}

export function runSystemReview(record: any, now = new Date().toISOString()) {
  const issues = getSystemReviewIssues(record);
  return {
    ...record,
    systemValidation: issues.length ? 'failed' : 'passed',
    systemReviewIssues: issues,
    systemReviewedAt: now,
    dataStatus: issues.length ? 'pending_system_validation' : 'pending_manual_review',
    recommendation: {
      ...record.recommendation,
      system_validation: issues.length ? 'failed' : 'passed',
    },
  };
}

export function runSystemReviewBatch(records: any[], now = new Date().toISOString()) {
  let passed = 0;
  let flagged = 0;
  let skipped = 0;
  const reviewedIds: string[] = [];
  const nextRecords = records.map(record => {
    if (record.dataStatus === 'published') {
      skipped += 1;
      return record;
    }
    const updated = runSystemReview(record, now);
    reviewedIds.push(record.id);
    if (updated.systemValidation === 'passed') passed += 1;
    else flagged += 1;
    return updated;
  });
  return { records: nextRecords, passed, flagged, skipped, reviewedIds };
}

export function publishRecord(record: any, now = new Date().toISOString()) {
  const blockers = getPublishBlockers(record);
  if (blockers.length) throw new Error(blockers.join('；'));
  return {
    ...record,
    dataStatus: 'published',
    publishedAt: now,
    updatedAt: now,
    updatedBy: 'admin@example.local',
    recommendation: { ...record.recommendation, published_cache: true },
  };
}

export function unpublishRecord(record: any, now = new Date().toISOString()) {
  return {
    ...record,
    dataStatus: 'offline',
    offlineAt: now,
    updatedAt: now,
    updatedBy: 'admin@example.local',
    recommendation: { ...record.recommendation, published_cache: false },
  };
}

export function buildProfessionCatalog(records: any[]): string[] {
  return Array.from(new Set(records.flatMap(record => Array.isArray(record.professions) ? record.professions : [])))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

export function normalizeProfessions(values: string[]): string[] {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}
