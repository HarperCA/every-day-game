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
  notice_resolution_pending: '通知线索待追溯赛事官网及官方报名入口',
};

function isNoticeTitle(value: unknown): boolean {
  const title = String(value || '').trim();
  return /通知/.test(title) || /^(关于|转发|【?通知】?|赛事通知[：:])/.test(title) || /通知\s*_/.test(title) || /(?:的通知|报名通知|参赛通知|选拔通知)$/.test(title);
}

function isNonEventTitle(value: unknown): boolean {
  const title = String(value || '').trim();
  return ['大赛动态','国赛公告','通知公告','竞赛分类:'].includes(title)
    || /(?:学术资讯速递|赛事目录(?:的公示)?|学科竞赛目录清单|竞赛项目目录)/.test(title)
    || /决赛(?:在[^，。]{0,15})?(?:举行|闭幕|落幕|收官)$/.test(title);
}

function noticeUnresolved(record: any): boolean {
  return isNoticeTitle(record.name) || isNoticeTitle(record.editionName) || isNonEventTitle(record.name) || (record.qualityIssues || []).includes('notice_resolution_pending');
}

function blockedTitle(record: any): boolean {
  return /[!！]|正式启动|正式开启|正式开赛|启动仪式|开幕仪式|正式拉开帷幕|火热开启|隆重开幕/.test(`${record.name || ''} ${record.editionName || ''}`);
}

export function getSystemReviewIssues(record: any): string[] {
  const issues = [...validateAdminRecord(record)];
  if (noticeUnresolved(record)) issues.push('通知线索待追溯真实赛事名称、官网和报名入口');
  if (blockedTitle(record)) issues.push('名称含感叹号或活动报道用语，不得入赛事库');
  if (!/^https?:\/\//i.test(record.registrationUrl || '')) issues.push('报名链接缺失或格式不正确');
  if (!record.lastVerifiedAt) issues.push('缺少最后核验时间');
  if (!(record.sources || []).some((source: any) => source.is_official && !['discovery_notice','university_notice','search_candidate'].includes(source.source_type) && /^https?:\/\//i.test(source.url || ''))) {
    issues.push('缺少有效格式的官方来源链接');
  }
  if (!Array.isArray(record.professions) || !record.professions.length) issues.push('尚未配置适合专业');
  for (const issue of record.qualityIssues || []) {
    issues.push(qualityIssueLabels[issue] || `待处理：${issue}`);
  }
  return Array.from(new Set(issues));
}

// 必须和服务器 publicCache.js 的 requirePublishGate 完全一致——那边是严格
// AND 的：人工审核通过不能豁免系统验证或来源核验。之前这里"人工审核通过就放行"
// 会让"发布"按钮显示可点、点了却被服务器拒绝保存（不落盘也不报错在界面上很显眼），
// 后台看着像发布成功，小程序其实什么都没收到。
export function getPublishBlockers(record: any): string[] {
  const blockers: string[] = [];
  if (noticeUnresolved(record)) blockers.push('通知线索尚未解析为赛事');
  if (blockedTitle(record)) blockers.push('名称含感叹号或活动报道用语');
  if (/(?:19|20)\d{2}|第[零〇一二三四五六七八九十百千万两\d]+届/.test(String(record.name || ''))) blockers.push('赛事名称尚未拆分年份和届次');
  if (record.systemValidation !== 'passed') blockers.push('系统验证未通过');
  if (record.manualReview !== 'passed') blockers.push('人工审核未通过');
  if (!/^https?:\/\//i.test(record.registrationUrl || '')) blockers.push('报名链接不可用');
  if (!record.lastVerifiedAt) blockers.push('缺少最后核验时间');
  if (!Array.isArray(record.professions) || !record.professions.length) blockers.push('适合专业未映射');
  if (!(record.sources || []).some((source: any) => source.is_official && !['discovery_notice','university_notice','search_candidate'].includes(source.source_type) && source.validity_status === 'valid' && /^https?:\/\//i.test(source.url || ''))) blockers.push('缺少已核验有效的官方来源');
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
