import { useMemo, useState } from 'react';
import { persistAdminRecordsWithAudit, type AuditEntry } from './dataStore';
import { getPublishBlockers, isPublishReady, publishRecord, runSystemReview, unpublishRecord, workflowStatusLabels } from './adminWorkflow';

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

  const rows = useMemo(() => records.filter(record => {
    if (keyword && !`${record.name} ${record.editionName}`.toLowerCase().includes(keyword.toLowerCase())) return false;
    if (filter === 'needs_review' && record.manualReview === 'passed') return false;
    if (filter === 'problems' && getPublishBlockers(record).length === 0) return false;
    if (filter === 'ready' && !isPublishReady(record)) return false;
    if (filter === 'published' && record.dataStatus !== 'published') return false;
    return true;
  }), [records, keyword, filter]);

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
    <header><div><h1>审核发布</h1><p>管理员人工复核赛事资料；确认无误后进入发布。</p></div></header>
    <section className="metrics"><article><span>待人工审核</span><strong>{records.filter(x => x.manualReview !== 'passed' && x.dataStatus !== 'published').length}</strong></article><article><span>发布受阻</span><strong>{records.filter(x => x.dataStatus !== 'published' && getPublishBlockers(x).length > 0).length}</strong></article><article><span>发布就绪</span><strong>{records.filter(isPublishReady).length}</strong></article><article><span>已发布</span><strong>{records.filter(x => x.dataStatus === 'published').length}</strong></article></section>
    <section className="panel workflow-panel">
      <div className="toolbar admin-toolbar"><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索赛事或届次"/><select value={filter} onChange={event => setFilter(event.target.value)}><option value="needs_review">待人工审核</option><option value="problems">发布受阻</option><option value="ready">发布就绪</option><option value="published">已发布</option><option value="all">全部赛事</option></select></div>
      <div className="table-wrap"><table><thead><tr><th>赛事</th><th>人工审核</th><th>发布门槛</th><th>数据状态</th><th>操作</th></tr></thead><tbody>{rows.map(record => {
        const blockers = getPublishBlockers(record);
        return <tr key={record.id}><td><b>{record.name}</b><small>{record.editionName}</small></td><td><span className={`review-state ${record.manualReview}`}>{workflowStatusLabels[record.manualReview] || record.manualReview}</span><small>{record.manualReviewReason || '等待人工确认'}</small></td><td className="issue-cell">{blockers.slice(0, 3).map((issue: string) => <span key={issue}>{issue}</span>)}{!blockers.length && <em>无阻断项</em>}</td><td>{record.dataStatus === 'published' ? '已发布' : record.dataStatus === 'offline' ? '已下架' : '审核中'}</td><td><div className="row-actions"><button className="edit-action" onClick={() => onEdit(record)}>编辑全部内容</button><button onClick={() => systemReview(record)}>运行系统验证</button><button onClick={() => manualReview(record, true)}>人工通过</button><button onClick={() => manualReview(record, false)}>退回</button><button className={record.dataStatus === 'published' ? 'danger-button' : 'primary-button'} onClick={() => togglePublish(record)}>{record.dataStatus === 'published' ? '下架' : '发布'}</button></div></td></tr>;
      })}</tbody></table></div>
      {!rows.length && <div className="empty-audit">当前筛选下没有赛事</div>}
    </section>
  </>;
}
