import { useMemo, useState } from 'react';
import { applyReviewDisposition } from './reviewDisposition';
import AiThinkingDialog from './AiThinkingDialog';
import { persistAdminRecordsWithAudit, type AuditEntry } from './dataStore';
import { getPublishBlockers, isPublishReady, publishRecord, runSystemReview, unpublishRecord, workflowStatusLabels } from './adminWorkflow';
import { computeAutoReviewQueue, describeAiReviewConfig, describeAiReviewRun, describeAutoReviewQueue, describeCloudError, requestAiReviewConfig, requestCompetitionAiReview, type AiReviewRun } from './adminCloud';

interface Props {
  records: any[];
  setRecords: (records: any[]) => void;
  setAudits: (audits: AuditEntry[]) => void;
  setNotice: (notice: string) => void;
  lastAiReviewRun?: AiReviewRun | null;
  onEdit: (record: any, index: number) => void;
}

export default function ReviewPublishModule({ records, setRecords, setAudits, setNotice, lastAiReviewRun = null, onEdit }: Props) {
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState('needs_review');
  const [aiReviewingId, setAiReviewingId] = useState('');
  const [thinkingRecord, setThinkingRecord] = useState<{ id:string; name:string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [aiBatchProgress, setAiBatchProgress] = useState<{ completed:number; total:number } | null>(null);

  const rows = useMemo(() => records.map((record, index) => {
    // AI 返回的 URL 只是待核查线索；只有记录中已核验有效的官方来源才能作为可点击证据。
    const verifiedUrls = new Set((record.sources || []).filter((source: any) => source.is_official && source.validity_status === 'valid').map((source: any) => source.url));
    const evidenceRefs = record.aiReview?.evidence_refs || [];
    const safeEvidenceRefs = evidenceRefs.filter((url: string) => verifiedUrls.has(url));
    return { ...record, __recordIndex:index, aiReview:record.aiReview ? { ...record.aiReview, evidence_refs:safeEvidenceRefs } : record.aiReview, blockedEvidenceCount:evidenceRefs.length - safeEvidenceRefs.length };
  }).filter(record => {
    if (record.dataStatus === 'quarantined') return false;
    if (keyword && !`${record.name} ${record.editionName}`.toLowerCase().includes(keyword.toLowerCase())) return false;
    if (filter === 'needs_review' && record.manualReview === 'passed') return false;
    if (filter === 'problems' && getPublishBlockers(record).length === 0) return false;
    if (filter === 'ready' && !isPublishReady(record)) return false;
    if (filter === 'published' && record.dataStatus !== 'published') return false;
    if (filter === 'archived' && record.dataStatus !== 'archived') return false;
    // 记录追溯、主办方公告栏监测挂上来的线索，还没人读原文核对的。
    if (filter === 'new_leads' && !(record.task?.leads || []).some((lead: any) => lead.status === '待核验')) return false;
    return true;
  }), [records, keyword, filter]);

  const autoReviewQueue = useMemo(() => computeAutoReviewQueue(records), [records]);

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
    let updated = {
      ...record,
      manualReview: passed ? 'passed' : 'rejected',
      manualReviewOverride: false,
      manualReviewReason: reason,
      manualReviewedAt: now,
      dataStatus: passed ? 'pending_manual_review' : 'reviewing',
      recommendation: { ...record.recommendation, manual_review: passed ? 'passed' : 'rejected' },
    };
    const changedFields = ['manualReview', 'manualReviewOverride', 'manualReviewReason', 'dataStatus'];
    if (passed) {
      // 人工审核本来就该核对来源链接，通过即视为官方来源已核验，
      // 不再要求管理员额外去编辑器里手动改 validity_status。
      updated = {
        ...updated,
        sources: (updated.sources || []).map((source: any) => source.is_official
          ? { ...source, validity_status: 'valid', last_verified_at: now }
          : source),
        qualityIssues: (updated.qualityIssues || []).filter((issue: string) => issue !== 'source_reachability_not_checked'),
      };
      updated = runSystemReview(updated, now); // 来源核验之外若还有别的真实问题（赛道未拆分、时间缺失等），系统验证仍会挡住
      changedFields.push('sources', 'qualityIssues', 'systemValidation', 'systemReviewIssues', 'systemReviewedAt');
    }
    commit(updated, passed ? 'manual_review_pass' : 'manual_review_reject', changedFields, reason);
    setNotice(`${record.name} 已${passed ? '通过人工审核' : '退回修改'}`);
  }

  function systemReview(record: any) {
    const updated = runSystemReview(record);
    commit(updated, 'system_validation_run', ['systemValidation', 'systemReviewIssues', 'systemReviewedAt', 'dataStatus']);
    setNotice(updated.systemValidation === 'passed' ? `${record.name} 系统验证通过` : `${record.name} 系统验证发现 ${updated.systemReviewIssues.length} 项问题`);
  }

  async function checkAiConfig() {
    setNotice('正在检查云函数的 AI 配置…');
    try {
      setNotice(describeAiReviewConfig(await requestAiReviewConfig()));
    } catch (error) {
      setNotice(`读取 AI 配置失败：${describeCloudError(error)}`);
    }
  }

  async function aiReview(record: any) {
    setAiReviewingId(record.id);
    setNotice(`${record.name} 正在进行 Kimi AI 审核（正在并行读取官方来源，请稍候）…`);
    try {
      const result = await requestCompetitionAiReview(record.id);
      const updated = applyReviewDisposition(record, result);
      commit(updated, 'ai_competition_review', ['aiReview'], `AI建议：${result.decision}；风险：${result.risk_level}`);
      setNotice(`${record.name} AI 审核完成：${result.summary}`);
    } catch (error) {
      setNotice(`AI 审核失败：${describeCloudError(error)}`);
    } finally {
      setAiReviewingId('');
    }
  }

  async function aiReviewBatch(recordIds: string[]) {
    const targets = records.filter(record => recordIds.includes(record.id) && record.dataStatus !== 'quarantined');
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
    // Kimi 端并发请求是排队的，多路并发只会让每条都逼近云函数 60 秒上限，所以逐条跑。
    await worker();
    if (results.size) {
      const now = new Date().toISOString();
      const next = records.map(record => results.has(record.id)
        ? applyReviewDisposition(record, results.get(record.id), now)
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
    <section className="metrics"><article><span>待人工审核</span><strong>{records.filter(x => x.manualReview !== 'passed' && x.dataStatus !== 'published').length}</strong></article><article><span>发布受阻</span><strong>{records.filter(x => x.dataStatus !== 'published' && getPublishBlockers(x).length > 0).length}</strong></article><article><span>发布就绪</span><strong>{records.filter(isPublishReady).length}</strong></article><article><span>已发布</span><strong>{records.filter(x => x.dataStatus === 'published').length}</strong></article><article><span>已归档</span><strong>{records.filter(x => x.dataStatus === 'archived').length}</strong></article><article><span>周检存疑</span><strong>{records.filter(x => x.dataStatus === 'published' && x.needsManualReview).length}</strong></article><article><span>草稿超时</span><strong>{records.filter(x => x.dataStatus === 'draft' && x.needsManualReview).length}</strong></article></section>
    <section className="panel workflow-panel">
      <div className="toolbar admin-toolbar"><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索赛事或届次"/><select value={filter} onChange={event => setFilter(event.target.value)}><option value="needs_review">待人工审核</option><option value="new_leads">有新线索待核验</option><option value="problems">发布受阻</option><option value="ready">发布就绪</option><option value="published">已发布</option><option value="archived">已归档</option><option value="all">全部赛事</option></select><button className="primary-button" disabled={Boolean(aiReviewingId) || selectedIds.length === 0} onClick={() => aiReviewBatch(selectedIds)}>检测已选（{selectedIds.length}）</button><button disabled={Boolean(aiReviewingId) || records.length === 0} onClick={() => aiReviewBatch(records.map(record => record.id))}>检测全部（{records.length}）</button><button onClick={checkAiConfig}>检查 AI 配置</button><span className={`weekly-ai-note${lastAiReviewRun?.status === 'failed' ? ' ai-run-failed' : ''}`}>{describeAiReviewRun(lastAiReviewRun)}</span>{aiBatchProgress && <span className="ai-batch-progress">正在检测 {aiBatchProgress.completed}/{aiBatchProgress.total}</span>}</div>
      <div className="table-wrap"><table><thead><tr><th><label className="table-check"><input type="checkbox" checked={allVisibleSelected} onChange={event => toggleVisibleSelection(event.target.checked)}/>选择</label></th><th>赛事</th><th>AI 审核</th><th>人工审核</th><th>发布门槛</th><th>数据状态</th><th>操作</th></tr></thead><tbody>{rows.map(record => {
        const blockers = getPublishBlockers(record);
        const ai = record.aiReview;
        const queueInfo = autoReviewQueue.get(record.id);
        return <tr key={`${record.id}-${record.__recordIndex}`}><td><input aria-label={`选择${record.name}`} type="checkbox" checked={selectedIds.includes(record.id)} onChange={event => toggleSelection(record.id, event.target.checked)}/></td><td><b>{record.name}</b><small>{record.editionName}</small></td><td className="issue-cell">{ai ? <><span>{ai.decision === 'recommend_approve' ? '建议通过' : ai.decision === 'needs_changes' ? '建议修改' : '证据不足'} · {ai.risk_level === 'high' ? '高风险' : ai.risk_level === 'medium' ? '中风险' : '低风险'}</span><small>{ai.summary}</small><small>{ai.reviewed_at ? `检测时间：${new Date(ai.reviewed_at).toLocaleString('zh-CN')}` : ''}</small>{(ai.evidence_refs || []).slice(0,2).map((url:string)=><a key={url} href={url} target="_blank" rel="noreferrer">查看证据</a>)}</> : <small>尚未运行</small>}{queueInfo && <small className={`auto-review-queue${queueInfo.backoff ? ' auto-review-backoff' : ''}`}>{describeAutoReviewQueue(queueInfo)}</small>}</td><td><span className={`review-state ${record.manualReview}`}>{workflowStatusLabels[record.manualReview] || record.manualReview}</span><small>{record.manualReviewReason || '等待人工确认'}</small></td><td className="issue-cell">{blockers.slice(0, 3).map((issue: string) => <span key={issue}>{issue}</span>)}{!blockers.length && <em>无阻断项</em>}</td><td>{record.dataStatus === 'published' ? <>已发布{record.aiAutoPublishNote && <small className="field-verification-flag">{record.aiAutoPublishNote}</small>}{record.needsManualReview && <small className="field-verification-flag">周检发现问题，需人工核对{record.fieldVerification?.summary ? `：${record.fieldVerification.summary}` : ''}</small>}</> : record.dataStatus === 'offline' ? '已下架' : record.dataStatus === 'archived' ? <>已归档<small>报名已截止{record.nextEditionEstimate ? `，预计约 ${new Date(record.nextEditionEstimate).toLocaleDateString('zh-CN')} 起下一届开始报名（按上届推算，仅供参考；只在后台显示，小程序里只写“已过报名日期”）` : '，下一届时间暂无法推算（小程序里只写“已过报名日期”）'}</small></> : <>审核中{record.dataStatus === 'draft' && record.needsManualReview && record.staleDraftReason && <small className="field-verification-flag">超过3天未处理：{record.staleDraftReason}</small>}</>}</td><td><div className="row-actions"><button className="edit-action" onClick={() => onEdit(record, record.__recordIndex)}>编辑全部内容</button><button disabled={Boolean(aiReviewingId)} onClick={() => aiReview(record)}>{aiReviewingId === record.id ? 'Kimi审核中…' : '运行Kimi审核'}</button><button onClick={() => setThinkingRecord({ id:record.id, name:record.name })}>AI思考过程</button><button onClick={() => systemReview(record)}>运行系统验证</button><button onClick={() => manualReview(record, true)}>人工通过</button><button onClick={() => manualReview(record, false)}>退回</button>{record.dataStatus !== 'archived' && <button className={record.dataStatus === 'published' ? 'danger-button' : 'primary-button'} onClick={() => togglePublish(record)}>{record.dataStatus === 'published' ? '下架' : '发布'}</button>}</div></td></tr>;
      })}</tbody></table></div>
      {!rows.length && <div className="empty-audit">当前筛选下没有赛事</div>}
    </section>
    {thinkingRecord && <AiThinkingDialog record={thinkingRecord} onClose={() => setThinkingRecord(null)}/>}
  </>;
}
