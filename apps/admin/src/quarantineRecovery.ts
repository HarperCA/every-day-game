import { getPublishBlockers, runSystemReview } from './adminWorkflow';
import { validateAdminRecord } from './validation';

export type RecoveryTarget = 'draft' | 'published' | 'archived';

export function prepareQuarantineRecovery(record:any, target:RecoveryTarget, now = new Date()):any {
  if (record.dataStatus !== 'quarantined') throw new Error('这条记录当前不是误收隔离状态，请刷新后台');
  const errors = validateAdminRecord(record);
  if (errors.length) throw new Error(errors.join('；'));
  const at = now.toISOString();
  const reason = target === 'draft' ? '管理员核对后恢复为草稿，等待重新审核'
    : target === 'published' ? '管理员核对当届官方证据后决定直接发布' : '管理员核对当届官方证据及截止时间后决定归档';
  const base = { ...record, quarantineResolution:{ at, actor:'manual_admin', from:'quarantined', to:target, reason },
    updatedAt:at, updatedBy:'manual_admin', recommendation:{ ...record.recommendation } };
  if (target === 'draft') return { ...base, dataStatus:'draft', manualReview:'pending', systemValidation:'not_run',
    manualReviewedAt:null, systemReviewedAt:null, systemReviewIssues:[],
    recommendation:{...base.recommendation,manual_review:'pending',system_validation:'not_run',published_cache:false} };
  if (target === 'published') {
    const end = Date.parse(record.schedule?.registration_end || '');
    if (Number.isFinite(end) && end < now.getTime()) throw new Error('报名已截止，不能直接发布；请核对后归档');
    const system = runSystemReview({...base,dataStatus:'draft'},at);
    if (system.systemValidation !== 'passed') throw new Error(`发布条件未通过：${system.systemReviewIssues.join('；')}`);
    const proposed = {...system,dataStatus:'published',manualReview:'passed',manualReviewReason:reason,
      manualReviewedAt:at,publishedAt:at,updatedAt:at,updatedBy:'manual_admin',
      recommendation:{...system.recommendation,manual_review:'passed',system_validation:'passed',published_cache:true}};
    const blockers = getPublishBlockers(proposed);
    if (blockers.length) throw new Error(`发布条件未通过：${blockers.join('；')}`);
    return proposed;
  }
  const end = Date.parse(record.schedule?.registration_end || '');
  if (!Number.isFinite(end) || end >= now.getTime()) throw new Error('归档前需要核实且已过的报名截止时间');
  return {...base,dataStatus:'archived',systemValidation:'passed',manualReview:'passed',
    systemReviewedAt:at,manualReviewedAt:at,manualReviewReason:reason,
    archivedAt:at,archivedReason:'manual_restored_expired',nextEditionEstimate:null,
    recommendation:{...base.recommendation,manual_review:'passed',system_validation:'passed',published_cache:true}};
}
