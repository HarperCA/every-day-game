import { useMemo, useState } from 'react';
import { persistAdminRecordsWithAudit, type AuditEntry } from './dataStore';
import { getPublishBlockers, isPublishReady, publishRecord, runSystemReview, unpublishRecord, workflowStatusLabels } from './adminWorkflow';
import { describeCloudError, requestCompetitionAiReview } from './adminCloud';

interface Props {
  records: any[];
  setRecords: (records: any[]) => void;
  setAudits: (audits: AuditEntry[]) => void;
  setNotice: (notice: string) => void;
  onEdit: (record: any) => void;
}

export default function ReviewPublishModule({ records, setRecords, setAudits, setNotice, onEdit }: Props) {
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState('needs_review');
  const [aiReviewingId, setAiReviewingId] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [aiBatchProgress, setAiBatchProgress] = useState<{ completed:number; total:number } | null>(null);

  const rows = useMemo(() => records.filter(record => {
    if (keyword && !`${record.name} ${record.editionName}`.toLowerCase().includes(keyword.toLowerCase())) return false;
    if (filter === 'needs_review' && record.manualReview === 'passed') return false;
    if (filter === 'problems' && getPublishBlockers(record).length === 0) return false;
    if (filter === 'ready' && !isPublishReady(record)) return false;
    if (filter === 'published' && record.dataStatus !== 'published') return false;
    return true;
  }), [records, keyword, filter]);

  const visibleIds = rows.map(record => record.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.includes(id));

  function toggleVisibleSelection(checked: boolean) {
    setSelectedIds(current => checked
      ? Array.from(new Set([...current, ...visibleIds]))
      : current.filter(id => !visibleIds.includes(id)));
  }

  function toggleSelection(id: string, checked: boolean) {
    setSelectedIds(current => checked ? Array.from(new Set([...current, id])) : current.filter(item => item !== id));
  }

  function commit(updated: any, action: string, changedFields: string[], reason?: string) {
    const next = records.map(record => record.id === updated.id ? updated : record);
    setRecords(next);
    setAudits(persistAdminRecordsWithAudit(next, { action, recordId: updated.id, recordName: updated.name, changedFields, actor: 'admin@example.local', reason }));
  }

  function manualReview(record: any, passed: boolean) {
    const reason = passed ? '人工复核确认' : window.prompt('请输入退回原因（必填）')?.trim();
    if (!passed && !reason) return;
    if (!window.confirm(`确定${passed ? '通过' : '退回'}“${record.name}”的人工审核吗？`)) return;
    const now = new Date().toISOString();
    const updated = {
      ...record,
      manualReview: passed ? 'passed' : 'rejected',
      manualReviewOverride: false,
      manualReviewReason: reason,
      manualReviewedAt: now,
      dataStatus: passed ? 'pending_manual_review' : 'reviewing',
      recommendation: { ...record.recommendation, manual_review: passed ? 'passed' : 'rejected' },
    };
    commit(updated, passed ? 'manual_review_pass' : 'manual_review_reject', ['manualReview', 'manualReviewOverride', 'manualReviewReason', 'dataStatus'], reason);
    setNotice(`${record.name} 已${passed ? '通过人工审核' : '退回修改'}`);
  }

  function systemReview(record: any) {
    const updated = runSystemReview(record);
    commit(updated, 'system_validation_run', ['systemValidation', 'systemReviewIssues', 'systemReviewedAt', 'dataStatus']);
    setNotice(updated.systemValidation === 'passed' ? `${record.name} 系统验证通过` : `${record.name} 系统验证发现 ${updated.systemReviewIssues.length} 项问题`);
  }

  async function aiReview(record: any) {
    setAiReviewingId(record.id);
    setNotice(`${record.name} 正在进行 Kimi AI 审核…`);
    try {
      const result = await requestCompetitionAiReview(record.id);
      const updated = { ...record, aiReview:result, updatedAt:new Date().toISOString(), updatedBy:'kimi-review-assistant' };
      commit(updated, 'ai_competition_review', ['aiReview'], `AI建议：${result.decision}；风险：${result.risk_level}`);
      setNotice(`${record.name} AI 审核完成：${result.summary}`);
    } catch (error) {
      setNotice(`AI 审核失败：${describeCloudError(error)}`);
    } finally {
      setAiReviewingId('');
    }
  }

  async function aiReviewBatch(recordIds: string[]) {
    const targets = records.filter(record => recordIds.includes(record.id));
    if (!targets.length) {
      setNotice('请先勾选要进行 AI 检测的赛事');
      return;
    }
    if (!window.confirm(`确定使用 Kimi 检测 ${targets.length} 条赛事吗？检测只生成复核建议，不会自动发布。`)) return;
    setAiReviewingId('*');
    setAiBatchProgress({ completed:0, total:targets.length });
    const results = new Map<string, any>();
    const failures: string[] = [];
    let cursor = 0;
    let completed = 0;
    async function worker() {
      while (cursor < targets.length) {
        const record = targets[cursor++];
        try {
          results.set(record.id, await requestCompetitionAiReview(record.id));
        } catch (error) {
          failures.push(`${record.name}：${describeCloudError(error)}`);
        } finally {
          completed += 1;
          setAiBatchProgress({ completed, total:targets.length });
        }
      }
    }
    await Promise.all(Array.from({ length:Math.min(3, targets.length) }, () => worker()));
    if (results.size) {
      const now = new Date().toISOString();
      const next = records.map(record => results.has(record.id)
        ? { ...record, aiReview:results.get(record.id), updatedAt:now, updatedBy:'kimi-review-assistant' }
        : record);
      setRecords(next);
      setAudits(persistAdminRecordsWithAudit(next, {
        action:'ai_competition_review_batch',
        recordId:'*',
        recordName:`批量 AI 检测（${results.size} 条）`,
        changedFields:['aiReview'],
        actor:'admin@example.local',
        reason:`手动选择 ${targets.length} 条；成功 ${results.size} 条；失败 ${failures.length} 条`,
      }));
    }
    setSelectedIds(current => current.filter(id => !results.has(id)));
    setAiReviewingId('');
    setAiBatchProgress(null);
    setNotice(failures.length
      ? `批量检测完成：成功 ${results.size} 条，失败 ${failures.length} 条。${failures[0]}`
      : `批量检测完成：${results.size} 条赛事已生成 AI 复核建议`);
  }

  function togglePublish(record: any) {
    if (record.dataStatus === 'published') {
      if (!window.confirm(`确定下架“${record.name}”吗？下架后小程序不应继续展示该届赛事。`)) return;
      commit(unpublishRecord(record), 'unpublish', ['dataStatus', 'offlineAt', 'recommendation.published_cache'], '管理员主动下架');
      setNotice(`${record.name} 已下架`);
      return;
    }
    const blockers = getPublishBlockers(record);
    if (blockers.length) {
      setNotice(`暂不能发布：${blockers.join('、')}`);
      return;
    }
    if (!window.confirm(`“${record.name}”已通过系统审核和人工审核。

确定发布到公开赛事数据吗？`)) return;
    commit(publishRecord(record), 'publish', ['dataStatus', 'publishedAt', 'recommendation.published_cache']);
    setNotice(`${record.name} 已发布`);
  }

  return <>
    <header><div><h1>审核发布</h1><p>每周自动全量检测；也可手动全选或勾选部分赛事运行 Kimi。AI 只给出复核建议，不会自动发布。</p></div></header>
    <section className="metrics"><article><span>待人工审核</span><strong>{records.filter(x => x.manualReview !== 'passed' && x.dataStatus !== 'published').length}</strong></article><article><span>发布受阻</span><strong>{records.filter(x => x.dataStatus !== 'published' && getPublishBlockers(x).length > 0).length}</strong></article><article><span>发布就绪</span><strong>{records.filter(isPublishReady).length}</strong></article><article><span>已发布</span><strong>{records.filter(x => x.dataStatus === 'published').length}</strong></article></section>
    <section className="panel workflow-panel">
      <div className="toolbar admin-toolbar"><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索赛事或届次"/><select value={filter} onChange={event => setFilter(event.target.value)}><option value="needs_review">待人工审核</option><option value="problems">发布受阻</option><option value="ready">发布就绪</option><option value="published">已发布</option><option value="all">全部赛事</option></select><button className="primary-button" disabled={Boolean(aiReviewingId) || selectedIds.length === 0} onClick={() => aiReviewBatch(selectedIds)}>检测已选（{selectedIds.length}）</button><button disabled={Boolean(aiReviewingId) || records.length === 0} onClick={() => aiReviewBatch(records.map(record => record.id))}>检测全部（{records.length}）</button><span className="weekly-ai-note">自动检测：每周一 03:00</span>{aiBatchProgress && <span className="ai-batch-progress">正在检测 {aiBatchProgress.completed}/{aiBatchProgress.total}</span>}</div>
      <div className="table-wrap"><table><thead><tr><th><label className="table-check"><input type="checkbox" checked={allVisibleSelected} onChange={event => toggleVisibleSelection(event.target.checked)}/>选择</label></th><th>赛事</th><th>AI 审核</th><th>人工审核</th><th>发布门槛</th><th>数据状态</th><th>操作</th></tr></thead><tbody>{rows.map(record => {
        const blockers = getPublishBlockers(record);
        const ai = record.aiReview;
        return <tr key={record.id}><td><input aria-label={`选择${record.name}`} type="checkbox" checked={selectedIds.includes(record.id)} onChange={event => toggleSelection(record.id, event.target.checked)}/></td><td><b>{record.name}</b><small>{record.editionName}</small></td><td className="issue-cell">{ai ? <><span>{ai.decision === 'recommend_approve' ? '建议通过' : ai.decision === 'needs_changes' ? '建议修改' : '证据不足'} · {ai.risk_level === 'high' ? '高风险' : ai.risk_level === 'medium' ? '中风险' : '低风险'}</span><small>{ai.summary}</small><small>{ai.reviewed_at ? `检测时间：${new Date(ai.reviewed_at).toLocaleString('zh-CN')}` : ''}</small>{(ai.evidence_refs || []).slice(0,2).map((url:string)=><a key={url} href={url} target="_blank" rel="noreferrer">查看证据</a>)}</> : <small>尚未运行</small>}</td><td><span className={`review-state ${record.manualReview}`}>{workflowStatusLabels[record.manualReview] || record.manualReview}</span><small>{record.manualReviewReason || '等待人工确认'}</small></td><td className="issue-cell">{blockers.slice(0, 3).map((issue: string) => <span key={issue}>{issue}</span>)}{!blockers.length && <em>无阻断项</em>}</td><td>{record.dataStatus === 'published' ? '已发布' : record.dataStatus === 'offline' ? '已下架' : '审核中'}</td><td><div className="row-actions"><button className="edit-action" onClick={() => onEdit(record)}>编辑全部内容</button><button disabled={Boolean(aiReviewingId)} onClick={() => aiReview(record)}>{aiReviewingId === record.id ? 'Kimi审核中…' : '运行Kimi审核'}</button><button onClick={() => systemReview(record)}>运行系统验证</button><button onClick={() => manualReview(record, true)}>人工通过</button><button onClick={() => manualReview(record, false)}>退回</button><button className={record.dataStatus === 'published' ? 'danger-button' : 'primary-button'} onClick={() => togglePublish(record)}>{record.dataStatus === 'published' ? '下架' : '发布'}</button></div></td></tr>;
      })}</tbody></table></div>
      {!rows.length && <div className="empty-audit">当前筛选下没有赛事</div>}
    </section>
  </>;
}
