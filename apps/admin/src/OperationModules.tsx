import { useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { appendAuditEntry, downloadJson, persistAdminRecords, type AuditEntry } from './dataStore';
import { changedOperationFields, loadAiJobs, loadFeedbacks, persistAiJobs, persistFeedbacks, validateAiJobRecord, validateFeedbackRecord, type AiJobRecord, type FeedbackRecord } from './operationsStore';

type Section = 'feedback' | 'ai_jobs' | 'audit';
interface Props {
  section: Section;
  records: any[];
  setRecords: Dispatch<SetStateAction<any[]>>;
  audits: AuditEntry[];
  setAudits: Dispatch<SetStateAction<AuditEntry[]>>;
  setNotice: Dispatch<SetStateAction<string>>;
}

const feedbackStatusLabels: Record<string,string> = { pending_ai_review:'待AI审核', ai_queued:'AI审核排队中', ai_passed:'AI已通过·待抽查', ai_flagged:'AI标记问题', human_reviewing:'人工审核中', accepted:'已采纳', rejected:'已驳回' };
const feedbackCategoryLabels: Record<string,string> = { time:'时间错误', registration_link:'报名链接', eligibility:'参赛资格', rules:'规则信息', other:'其他' };
const aiStatusLabels: Record<string,string> = { failed:'执行失败', queued:'已排队重试', manual_required:'需人工处理', resolved:'已关闭' };
const aiJobLabels: Record<string,string> = { recommendation_generate:'推荐生成', source_extract:'来源抽取', data_validation:'数据验证', feedback_review:'纠错AI预审' };
const feedbackEditableFields: (keyof FeedbackRecord)[] = ['competitionName','category','content','evidenceUrl','submitterMasked','status','aiDecision','aiRiskLevel','aiConclusion','aiEvidenceSummary','spotCheckStatus','reviewer','reviewNote'];
const aiJobEditableFields: (keyof AiJobRecord)[] = ['competitionName','jobType','status','provider','model','errorCode','errorMessage','retryCount','maxRetries','lastAttemptAt','nextRetryAt'];

function isoToLocalInput(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0,16);
}

function localInputToIso(value: string) {
  return value ? new Date(value).toISOString() : undefined;
}

export default function OperationModules({ section, records, setRecords, audits, setAudits, setNotice }: Props) {
  const [feedbacks, setFeedbacks] = useState(() => loadFeedbacks());
  const [aiJobs, setAiJobs] = useState(() => loadAiJobs());
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [feedbackView, setFeedbackView] = useState<'all'|'pending_ai'|'issues'|'spot_check'|'completed'>('all');
  const [reviewing, setReviewing] = useState<FeedbackRecord|null>(null);
  const [reviewDecision, setReviewDecision] = useState<'accepted'|'rejected'>('accepted');
  const [reviewNote, setReviewNote] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [editingFeedback, setEditingFeedback] = useState<FeedbackRecord|null>(null);
  const [feedbackEditErrors, setFeedbackEditErrors] = useState<string[]>([]);
  const [feedbackEditReason, setFeedbackEditReason] = useState('');
  const [editingAiJob, setEditingAiJob] = useState<AiJobRecord|null>(null);
  const [aiJobEditErrors, setAiJobEditErrors] = useState<string[]>([]);
  const [aiJobEditReason, setAiJobEditReason] = useState('');

  const feedbackRows = useMemo(() => feedbacks.filter(item => {
    const viewMatches = feedbackView === 'all' || (feedbackView === 'pending_ai' && ['pending_ai_review','ai_queued'].includes(item.status)) || (feedbackView === 'issues' && ['ai_flagged','human_reviewing'].includes(item.status)) || (feedbackView === 'spot_check' && item.status === 'ai_passed') || (feedbackView === 'completed' && ['accepted','rejected'].includes(item.status));
    return viewMatches && (!statusFilter || item.status === statusFilter) && (!keyword || [item.competitionName,item.content,item.submitterMasked,item.aiConclusion||''].join(' ').toLowerCase().includes(keyword.toLowerCase()));
  }), [feedbacks,statusFilter,keyword,feedbackView]);
  const aiRows = useMemo(() => aiJobs.filter(item => (!statusFilter || item.status === statusFilter) && (!keyword || [item.competitionName,item.errorCode,item.errorMessage].join(' ').toLowerCase().includes(keyword.toLowerCase()))), [aiJobs,statusFilter,keyword]);
  const auditRows = useMemo(() => audits.filter(item => (!statusFilter || item.action === statusFilter) && (!keyword || [item.recordName,item.actor,item.action,...item.changedFields].join(' ').toLowerCase().includes(keyword.toLowerCase()))), [audits,statusFilter,keyword]);
  const spotCheckedCount = feedbacks.filter(item=>item.spotCheckStatus==='correct'||item.spotCheckStatus==='incorrect').length;
  const spotCheckAccuracy = spotCheckedCount ? `${Math.round(feedbacks.filter(item=>item.spotCheckStatus==='correct').length / spotCheckedCount * 100)}%` : '—';

  function recordAudit(action: string, objectType: string, recordId: string, recordName: string, changedFields: string[], metadata?: Pick<AuditEntry,'reason'|'changes'>) {
    setAudits(appendAuditEntry({ action, objectType, recordId, recordName, changedFields, actor:'admin@example.local', ...metadata }));
  }

  function openReview(item: FeedbackRecord) {
    setReviewing({ ...item, status:'human_reviewing', reviewer:'admin@example.local' });
    setReviewDecision('accepted'); setReviewNote(''); setReviewError('');
  }

  function submitReview() {
    if (!reviewing) return;
    if (reviewNote.trim().length < 5) { setReviewError('请填写至少5个字的审核说明'); return; }
    const now = new Date().toISOString();
    const next = feedbacks.map(item => item.id === reviewing.id ? { ...item, status:reviewDecision, reviewer:'admin@example.local', reviewNote:reviewNote.trim(), resolvedAt:now } as FeedbackRecord : item);
    setFeedbacks(next); persistFeedbacks(next);
    if (reviewDecision === 'accepted') {
      const nextRecords = records.map(item => item.id === reviewing.editionId ? { ...item, dataStatus:'reviewing', manualReview:'pending', qualityIssues:Array.from(new Set([...(item.qualityIssues||[]),'user_feedback_requires_review'])), updatedAt:now, updatedBy:'admin@example.local' } : item);
      setRecords(nextRecords); persistAdminRecords(nextRecords);
    }
    recordAudit(reviewDecision === 'accepted' ? 'feedback_accept' : 'feedback_reject', 'feedback', reviewing.id, reviewing.competitionName, ['status','review_note',...(reviewDecision === 'accepted' ? ['event_edition.data_status'] : [])]);
    setNotice(reviewDecision === 'accepted' ? '纠错已采纳，关联赛事已进入资料复核状态' : '纠错已驳回并记录审核理由');
    setReviewing(null);
  }

  function queueFeedbacksForAi(items: FeedbackRecord[]) {
    const targets = items.filter(item => item.status === 'pending_ai_review');
    if (!targets.length) { setNotice('没有待加入AI审核队列的纠错'); return; }
    const now = new Date().toISOString();
    const targetIds = new Set(targets.map(item => item.id));
    const nextFeedbacks = feedbacks.map(item => targetIds.has(item.id) ? { ...item, status:'ai_queued' as const, aiJobId:item.aiJobId||`ai-job-${item.id}`, spotCheckStatus:'not_checked' as const } : item);
    const existingJobIds = new Set(aiJobs.map(job=>job.id));
    const newJobs: AiJobRecord[] = targets.filter(item=>!existingJobIds.has(item.aiJobId||`ai-job-${item.id}`)).map(item=>({
      id:item.aiJobId||`ai-job-${item.id}`, editionId:item.editionId, competitionName:item.competitionName, jobType:'feedback_review', status:'queued',
      provider:'待服务端配置', model:'待服务端配置', errorCode:'pending_execution', errorMessage:'等待服务端AI预审任务处理器执行。',
      retryCount:0, maxRetries:2, lastAttemptAt:now, nextRetryAt:now, source:'service',
    }));
    const nextJobs = [...newJobs,...aiJobs];
    setFeedbacks(nextFeedbacks); persistFeedbacks(nextFeedbacks);
    setAiJobs(nextJobs); persistAiJobs(nextJobs);
    targets.forEach(item=>recordAudit('feedback_ai_queue','feedback',item.id,item.competitionName,['status','ai_job_id']));
    setNotice(`已将 ${targets.length} 条纠错加入AI审核队列；只有服务端返回结果后才会进入通过池或问题列表`);
  }

  function spotCheck(item: FeedbackRecord, correct: boolean) {
    const now = new Date().toISOString();
    if (correct) {
      const finalStatus = item.aiDecision === 'rejected' ? 'rejected' : 'accepted';
      const next = feedbacks.map(row=>row.id===item.id?{...row,status:finalStatus as 'accepted'|'rejected',spotCheckStatus:'correct' as const,spotCheckedAt:now,reviewer:'admin@example.local',reviewNote:`抽查确认AI结论正确：${item.aiConclusion||''}`,resolvedAt:now}:row);
      setFeedbacks(next); persistFeedbacks(next);
      if (finalStatus === 'accepted') {
        const nextRecords = records.map(record=>record.id===item.editionId?{...record,dataStatus:'reviewing',manualReview:'pending',qualityIssues:Array.from(new Set([...(record.qualityIssues||[]),'user_feedback_requires_review'])),updatedAt:now,updatedBy:'admin@example.local'}:record);
        setRecords(nextRecords); persistAdminRecords(nextRecords);
      }
      recordAudit('feedback_spotcheck_correct','feedback',item.id,item.competitionName,['spot_check_status','status']);
      setNotice('已记录抽查正确，并按AI结论完成该条纠错');
    } else {
      const next = feedbacks.map(row=>row.id===item.id?{...row,status:'ai_flagged' as const,spotCheckStatus:'incorrect' as const,spotCheckedAt:now}:row);
      setFeedbacks(next); persistFeedbacks(next);
      const nextJobs = aiJobs.map(job=>job.id===item.aiJobId?{...job,status:'manual_required' as const,errorCode:'spot_check_incorrect',errorMessage:'管理员抽查发现AI审核结论不正确，已转人工复核。'}:job);
      setAiJobs(nextJobs); persistAiJobs(nextJobs);
      recordAudit('feedback_spotcheck_incorrect','feedback',item.id,item.competitionName,['spot_check_status','status','ai_job.status']);
      setNotice('已标记AI审核有误，该纠错已进入问题待人工审核列表');
      setFeedbackView('issues');
    }
  }

  function handleAiJob(item: AiJobRecord, action: 'retry'|'manual'|'resolve') {
    const now = new Date();
    let updated: AiJobRecord;
    if (action === 'retry') {
      if (item.retryCount >= item.maxRetries) {
        updated = { ...item, status:'manual_required' };
        setNotice('该任务已达到自动重试上限，已转人工处理');
      } else {
        updated = { ...item, status:'queued', retryCount:item.retryCount+1, nextRetryAt:new Date(now.getTime()+5*60*1000).toISOString() };
        setNotice('任务已加入重试队列；开发模式不会伪造AI执行成功');
      }
    } else if (action === 'manual') {
      updated = { ...item, status:'manual_required', nextRetryAt:undefined };
      setNotice('任务已转人工处理');
    } else {
      if (!window.confirm('确定将该AI失败任务标记为已关闭吗？')) return;
      updated = { ...item, status:'resolved', resolvedAt:now.toISOString(), nextRetryAt:undefined };
      setNotice('任务已关闭');
    }
    const next = aiJobs.map(job => job.id === item.id ? updated : job);
    setAiJobs(next); persistAiJobs(next);
    recordAudit(`ai_job_${action}`, 'ai_job', item.id, item.competitionName, ['status',...(action==='retry'?['retry_count','next_retry_at']:[])]);
  }

  function openFeedbackEditor(item: FeedbackRecord) {
    setEditingFeedback({ ...item });
    setFeedbackEditErrors([]);
    setFeedbackEditReason('');
  }

  function updateFeedbackField<K extends keyof FeedbackRecord>(field: K, value: FeedbackRecord[K]) {
    setEditingFeedback(current => current ? { ...current, [field]:value } : current);
  }

  function saveFeedbackEdit() {
    if (!editingFeedback) return;
    const original = feedbacks.find(item=>item.id===editingFeedback.id);
    if (!original) return;
    const errors = validateFeedbackRecord(editingFeedback);
    if (feedbackEditReason.trim().length < 5) errors.push('修改原因至少填写5个字');
    const changedFields = changedOperationFields(original, editingFeedback, feedbackEditableFields);
    if (!changedFields.length) errors.push('没有检测到可保存的修改');
    if (errors.length) { setFeedbackEditErrors(errors); return; }
    if (!window.confirm(`确定保存这条纠错记录的 ${changedFields.length} 项修改吗？\n变更字段：${changedFields.join('、')}`)) return;
    const next = feedbacks.map(item=>item.id===editingFeedback.id?editingFeedback:item);
    const changes = Object.fromEntries(changedFields.map(field=>[field,{before:(original as any)[field],after:(editingFeedback as any)[field]}]));
    setFeedbacks(next); persistFeedbacks(next);
    recordAudit('feedback_update','feedback',editingFeedback.id,editingFeedback.competitionName,changedFields,{reason:feedbackEditReason.trim(),changes});
    setNotice(`已保存纠错记录的 ${changedFields.length} 项修改`);
    setEditingFeedback(null);
  }

  function openAiJobEditor(item: AiJobRecord) {
    setEditingAiJob({ ...item });
    setAiJobEditErrors([]);
    setAiJobEditReason('');
  }

  function updateAiJobField<K extends keyof AiJobRecord>(field: K, value: AiJobRecord[K]) {
    setEditingAiJob(current => current ? { ...current, [field]:value } : current);
  }

  function saveAiJobEdit() {
    if (!editingAiJob) return;
    const original = aiJobs.find(item=>item.id===editingAiJob.id);
    if (!original) return;
    const errors = validateAiJobRecord(editingAiJob);
    if (aiJobEditReason.trim().length < 5) errors.push('修改原因至少填写5个字');
    const changedFields = changedOperationFields(original, editingAiJob, aiJobEditableFields);
    if (!changedFields.length) errors.push('没有检测到可保存的修改');
    if (errors.length) { setAiJobEditErrors(errors); return; }
    if (!window.confirm(`确定保存这条AI任务的 ${changedFields.length} 项修改吗？\n此操作只修改任务配置，不代表AI已经执行成功。\n变更字段：${changedFields.join('、')}`)) return;
    const next = aiJobs.map(item=>item.id===editingAiJob.id?editingAiJob:item);
    const changes = Object.fromEntries(changedFields.map(field=>[field,{before:(original as any)[field],after:(editingAiJob as any)[field]}]));
    setAiJobs(next); persistAiJobs(next);
    recordAudit('ai_job_update','ai_job',editingAiJob.id,editingAiJob.competitionName,changedFields,{reason:aiJobEditReason.trim(),changes});
    setNotice(`已保存AI任务的 ${changedFields.length} 项修改`);
    setEditingAiJob(null);
  }

  const header = section === 'feedback' ? ['纠错审核','核对用户提交的时间、链接、资格和规则问题'] : section === 'ai_jobs' ? ['AI失败任务','管理失败重试、人工接管和关闭状态'] : ['操作记录','查询后台关键写操作和处理轨迹'];
  return <>
    <header><div><h1>{header[0]}</h1><p>{header[1]}</p></div><div className="header-actions">{section==='feedback'&&<button className="primary" onClick={()=>queueFeedbacksForAi(feedbacks)}>待审核全部加入AI</button>}<button onClick={()=>downloadJson(section==='audit'?'audit-log':section, section==='feedback'?{feedbacks}:section==='ai_jobs'?{aiJobs}:{audits})}>导出 JSON</button></div></header>
    {section==='feedback'&&<div className="mock-data-banner">{feedbacks.some(item=>item.source==='user_submission')?'当前列表包含真实用户提交；“开发样例”记录仅用于流程验收。':'开发预览：当前纠错列表均为验收样例，不代表真实用户提交。'}</div>}
    {section==='ai_jobs'&&<div className="mock-data-banner">{aiJobs.some(item=>item.source==='service')?'当前列表同时包含服务端队列记录和开发样例；任务状态不等于外部 AI 已执行。':'开发预览：当前任务列表均为验收样例，不代表真实 AI 调用。'}</div>}
    {section === 'feedback' && <>
      <section className="metrics"><article><span>待AI审核</span><strong>{feedbacks.filter(x=>['pending_ai_review','ai_queued'].includes(x.status)).length}</strong></article><article><span>AI标记问题</span><strong>{feedbacks.filter(x=>['ai_flagged','human_reviewing'].includes(x.status)).length}</strong></article><article><span>AI通过抽查池</span><strong>{feedbacks.filter(x=>x.status==='ai_passed').length}</strong></article><article><span>累计抽查正确率</span><strong>{spotCheckAccuracy}</strong><small>已抽查 {spotCheckedCount} 条</small></article></section>
      <div className="workflow-tabs"><button className={feedbackView==='all'?'active-tab':''} onClick={()=>setFeedbackView('all')}>全部</button><button className={feedbackView==='pending_ai'?'active-tab':''} onClick={()=>setFeedbackView('pending_ai')}>待AI审核</button><button className={feedbackView==='issues'?'active-tab problem-tab':''} onClick={()=>setFeedbackView('issues')}>问题待人工审核 · {feedbacks.filter(x=>['ai_flagged','human_reviewing'].includes(x.status)).length}</button><button className={feedbackView==='spot_check'?'active-tab':''} onClick={()=>setFeedbackView('spot_check')}>AI通过抽查池 · {feedbacks.filter(x=>x.status==='ai_passed').length}</button><button className={feedbackView==='completed'?'active-tab':''} onClick={()=>setFeedbackView('completed')}>已完成</button></div>
      <section className="panel"><div className="toolbar"><input value={keyword} onChange={e=>setKeyword(e.target.value)} placeholder="搜索赛事、纠错内容、AI结论或用户"/><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="">全部状态</option>{Object.entries(feedbackStatusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div><div className="table-wrap"><table><thead><tr><th>赛事</th><th>纠错内容</th><th>证据</th><th>AI审核结果</th><th>状态</th><th>操作</th></tr></thead><tbody>{feedbackRows.map(item=><tr key={item.id}><td><b>{item.competitionName}</b><small>{feedbackCategoryLabels[item.category]} · {item.submitterMasked}</small></td><td className="long-cell">{item.content}<small>{item.createdAt.slice(0,16).replace('T',' ')}</small></td><td>{item.evidenceUrl?<a href={item.evidenceUrl} target="_blank" rel="noreferrer">查看证据</a>:<span className="muted-text">未提供</span>}</td><td className="ai-review-cell">{item.aiConclusion?<><span className={`risk-badge risk-${item.aiRiskLevel}`}>{item.aiRiskLevel==='high'?'高风险':item.aiRiskLevel==='medium'?'中风险':'低风险'}</span><p>{item.aiConclusion}</p><small>{item.aiEvidenceSummary}</small></>:<span className="muted-text">尚无AI审核结果</span>}</td><td><span className={`admin-badge badge-${item.status}`}>{feedbackStatusLabels[item.status]}</span>{item.spotCheckStatus==='incorrect'&&<small className="incorrect-text">抽查发现AI有误</small>}{item.reviewNote&&<small>{item.reviewNote}</small>}</td><td><div className="row-actions"><button className="edit-action" onClick={()=>openFeedbackEditor(item)}>编辑</button>{item.status==='pending_ai_review'&&<button onClick={()=>queueFeedbacksForAi([item])}>加入AI审核</button>}{item.status==='ai_queued'&&<span className="muted-text">等待AI任务执行</span>}{['ai_flagged','human_reviewing'].includes(item.status)&&<button onClick={()=>openReview(item)}>人工审核</button>}{item.status==='ai_passed'&&<><button onClick={()=>spotCheck(item,true)}>抽查正确</button><button className="danger-action" onClick={()=>spotCheck(item,false)}>抽查有误</button></>}{['accepted','rejected'].includes(item.status)&&<span className="muted-text">已完成</span>}</div></td></tr>)}</tbody></table></div><footer>显示 {feedbackRows.length} / {feedbacks.length} 条 · AI问题单独进入人工列表，AI通过结果保留在抽查池</footer></section>
    </>}
    {section === 'ai_jobs' && <>
      <section className="metrics"><article><span>全部失败任务</span><strong>{aiJobs.length}</strong></article><article><span>执行失败</span><strong>{aiJobs.filter(x=>x.status==='failed').length}</strong></article><article><span>重试队列</span><strong>{aiJobs.filter(x=>x.status==='queued').length}</strong></article><article><span>需人工处理</span><strong>{aiJobs.filter(x=>x.status==='manual_required').length}</strong></article></section>
      <section className="panel"><div className="toolbar"><input value={keyword} onChange={e=>setKeyword(e.target.value)} placeholder="搜索赛事、错误码或错误信息"/><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="">全部状态</option>{Object.entries(aiStatusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div><div className="table-wrap"><table><thead><tr><th>赛事与任务</th><th>Provider / 模型</th><th>错误</th><th>重试</th><th>状态</th><th>操作</th></tr></thead><tbody>{aiRows.map(item=><tr key={item.id}><td><b>{item.competitionName}</b><small>{aiJobLabels[item.jobType]} · {item.editionId}</small></td><td>{item.provider}<small>{item.model}</small></td><td className="long-cell"><code>{item.errorCode}</code><small>{item.errorMessage}</small></td><td>{item.retryCount} / {item.maxRetries}<small>{item.nextRetryAt?`下次 ${item.nextRetryAt.slice(0,16).replace('T',' ')}`:`最近 ${item.lastAttemptAt.slice(0,16).replace('T',' ')}`}</small></td><td><span className={`admin-badge badge-${item.status}`}>{aiStatusLabels[item.status]}</span></td><td><div className="row-actions"><button className="edit-action" onClick={()=>openAiJobEditor(item)}>编辑任务</button>{item.status!=='resolved'&&<button onClick={()=>handleAiJob(item,'retry')}>重试</button>}{item.status!=='manual_required'&&item.status!=='resolved'&&<button onClick={()=>handleAiJob(item,'manual')}>转人工</button>}{item.status!=='resolved'&&<button onClick={()=>handleAiJob(item,'resolve')}>关闭</button>}</div></td></tr>)}</tbody></table></div><footer>Mock任务只验证队列状态，不会伪造外部AI调用；正式执行由受控服务端任务处理器完成</footer></section>
    </>}
    {section === 'audit' && <section className="panel audit-table-panel"><div className="toolbar"><input value={keyword} onChange={e=>setKeyword(e.target.value)} placeholder="搜索对象、管理员或字段"/><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="">全部动作</option>{Array.from(new Set(audits.map(item=>item.action))).map(value=><option key={value}>{value}</option>)}</select></div><div className="table-wrap"><table><thead><tr><th>时间</th><th>管理员</th><th>动作</th><th>对象类型</th><th>对象</th><th>变更字段</th><th>修改原因</th></tr></thead><tbody>{auditRows.map(item=><tr key={item.id}><td>{item.createdAt.slice(0,19).replace('T',' ')}</td><td>{item.actor}</td><td><code>{item.action}</code></td><td>{item.objectType||'event_edition'}</td><td><b>{item.recordName}</b><small>{item.recordId}</small></td><td>{item.changedFields.join('、')||'—'}</td><td>{item.reason||'—'}</td></tr>)}</tbody></table></div><footer>显示 {auditRows.length} / {audits.length} 条 · 云端最多加载最近100条</footer></section>}
    {editingFeedback&&<div className="modal-mask" onMouseDown={()=>setEditingFeedback(null)}><section className="editor-modal operation-editor" onMouseDown={event=>event.stopPropagation()}><div className="editor-head"><div><h2>编辑纠错记录</h2><p>{editingFeedback.competitionName}</p></div><button className="modal-close" onClick={()=>setEditingFeedback(null)}>×</button></div><div className="editor-note">纠错 ID、关联届次和提交时间保持只读；其余审核与AI字段可直接修改。保存前会再次确认并写入操作记录。</div><div className="editor-grid">
      <label>纠错 ID（只读）<input value={editingFeedback.id} readOnly/></label><label>届次 ID（只读）<input value={editingFeedback.editionId} readOnly/></label>
      <label>赛事名称<input value={editingFeedback.competitionName} onChange={e=>updateFeedbackField('competitionName',e.target.value)}/></label><label>提交用户<input value={editingFeedback.submitterMasked} onChange={e=>updateFeedbackField('submitterMasked',e.target.value)}/></label>
      <label>纠错分类<select value={editingFeedback.category} onChange={e=>updateFeedbackField('category',e.target.value as FeedbackRecord['category'])}>{Object.entries(feedbackCategoryLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>处理状态<select value={editingFeedback.status} onChange={e=>updateFeedbackField('status',e.target.value as FeedbackRecord['status'])}>{Object.entries(feedbackStatusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label className="wide">纠错内容<textarea value={editingFeedback.content} onChange={e=>updateFeedbackField('content',e.target.value)}/></label><label className="wide">证据链接<input value={editingFeedback.evidenceUrl} onChange={e=>updateFeedbackField('evidenceUrl',e.target.value)}/></label>
      <label>AI建议<select value={editingFeedback.aiDecision||''} onChange={e=>updateFeedbackField('aiDecision',(e.target.value||undefined) as FeedbackRecord['aiDecision'])}><option value="">未设置</option><option value="accepted">建议采纳</option><option value="rejected">建议驳回</option></select></label><label>AI风险<select value={editingFeedback.aiRiskLevel||''} onChange={e=>updateFeedbackField('aiRiskLevel',(e.target.value||undefined) as FeedbackRecord['aiRiskLevel'])}><option value="">未设置</option><option value="low">低风险</option><option value="medium">中风险</option><option value="high">高风险</option></select></label>
      <label className="wide">AI结论<textarea value={editingFeedback.aiConclusion||''} onChange={e=>updateFeedbackField('aiConclusion',e.target.value||undefined)}/></label><label className="wide">AI证据摘要<textarea value={editingFeedback.aiEvidenceSummary||''} onChange={e=>updateFeedbackField('aiEvidenceSummary',e.target.value||undefined)}/></label>
      <label>抽查状态<select value={editingFeedback.spotCheckStatus||'not_checked'} onChange={e=>updateFeedbackField('spotCheckStatus',e.target.value as FeedbackRecord['spotCheckStatus'])}><option value="not_checked">未抽查</option><option value="correct">抽查正确</option><option value="incorrect">抽查有误</option></select></label><label>审核人<input value={editingFeedback.reviewer||''} onChange={e=>updateFeedbackField('reviewer',e.target.value||undefined)}/></label>
      <label className="wide">审核说明<textarea value={editingFeedback.reviewNote||''} onChange={e=>updateFeedbackField('reviewNote',e.target.value||undefined)}/></label><label className="wide">本次修改原因<textarea value={feedbackEditReason} onChange={e=>setFeedbackEditReason(e.target.value)} placeholder="至少5个字，操作记录中会保留该原因"/></label>
    </div>{feedbackEditErrors.length>0&&<div className="editor-errors">{feedbackEditErrors.map(error=><div key={error}>{error}</div>)}</div>}<div className="editor-actions sticky-actions"><button onClick={()=>setEditingFeedback(null)}>取消</button><button className="primary" onClick={saveFeedbackEdit}>保存修改</button></div></section></div>}
    {editingAiJob&&<div className="modal-mask" onMouseDown={()=>setEditingAiJob(null)}><section className="editor-modal operation-editor" onMouseDown={event=>event.stopPropagation()}><div className="editor-head"><div><h2>编辑AI失败任务</h2><p>{editingAiJob.competitionName}</p></div><button className="modal-close" onClick={()=>setEditingAiJob(null)}>×</button></div><div className="editor-note">任务 ID 与关联届次保持只读。修改任务配置不会被视为AI执行成功；保存前会再次确认并写入操作记录。</div><div className="editor-grid">
      <label>任务 ID（只读）<input value={editingAiJob.id} readOnly/></label><label>届次 ID（只读）<input value={editingAiJob.editionId} readOnly/></label>
      <label>赛事名称<input value={editingAiJob.competitionName} onChange={e=>updateAiJobField('competitionName',e.target.value)}/></label><label>任务类型<select value={editingAiJob.jobType} onChange={e=>updateAiJobField('jobType',e.target.value as AiJobRecord['jobType'])}>{Object.entries(aiJobLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label>任务状态<select value={editingAiJob.status} onChange={e=>updateAiJobField('status',e.target.value as AiJobRecord['status'])}>{Object.entries(aiStatusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>Provider<input value={editingAiJob.provider} onChange={e=>updateAiJobField('provider',e.target.value)}/></label>
      <label>模型<input value={editingAiJob.model} onChange={e=>updateAiJobField('model',e.target.value)}/></label><label>错误码<input value={editingAiJob.errorCode} onChange={e=>updateAiJobField('errorCode',e.target.value)}/></label>
      <label className="wide">错误信息<textarea value={editingAiJob.errorMessage} onChange={e=>updateAiJobField('errorMessage',e.target.value)}/></label>
      <label>已重试次数<input type="number" min="0" value={editingAiJob.retryCount} onChange={e=>updateAiJobField('retryCount',Number(e.target.value))}/></label><label>最大重试次数<input type="number" min="0" value={editingAiJob.maxRetries} onChange={e=>updateAiJobField('maxRetries',Number(e.target.value))}/></label>
      <label>最近执行时间<input type="datetime-local" value={isoToLocalInput(editingAiJob.lastAttemptAt)} onChange={e=>updateAiJobField('lastAttemptAt',localInputToIso(e.target.value)||editingAiJob.lastAttemptAt)}/></label><label>下次重试时间<input type="datetime-local" value={isoToLocalInput(editingAiJob.nextRetryAt)} onChange={e=>updateAiJobField('nextRetryAt',localInputToIso(e.target.value))}/></label>
      <label className="wide">本次修改原因<textarea value={aiJobEditReason} onChange={e=>setAiJobEditReason(e.target.value)} placeholder="至少5个字，操作记录中会保留该原因"/></label>
    </div>{aiJobEditErrors.length>0&&<div className="editor-errors">{aiJobEditErrors.map(error=><div key={error}>{error}</div>)}</div>}<div className="editor-actions sticky-actions"><button onClick={()=>setEditingAiJob(null)}>取消</button><button className="primary" onClick={saveAiJobEdit}>保存修改</button></div></section></div>}
    {reviewing&&<div className="modal-mask" onMouseDown={()=>setReviewing(null)}><section className="editor-modal review-modal" onMouseDown={event=>event.stopPropagation()}><div className="editor-head"><div><h2>人工审核AI问题</h2><p>{reviewing.competitionName}</p></div><button className="modal-close" onClick={()=>setReviewing(null)}>×</button></div><div className="feedback-detail"><b>{feedbackCategoryLabels[reviewing.category]}</b><p>{reviewing.content}</p>{reviewing.evidenceUrl&&<a href={reviewing.evidenceUrl} target="_blank" rel="noreferrer">打开用户提供的证据链接</a>}</div>{reviewing.aiConclusion&&<div className="ai-review-summary"><b>AI预审结论 · {reviewing.aiRiskLevel==='high'?'高风险':reviewing.aiRiskLevel==='medium'?'中风险':'低风险'}</b><p>{reviewing.aiConclusion}</p><small>{reviewing.aiEvidenceSummary}</small></div>}<div className="decision-row"><label><input type="radio" checked={reviewDecision==='accepted'} onChange={()=>setReviewDecision('accepted')}/> 采纳并进入资料复核</label><label><input type="radio" checked={reviewDecision==='rejected'} onChange={()=>setReviewDecision('rejected')}/> 驳回</label></div><label className="review-note">人工审核说明<textarea value={reviewNote} onChange={e=>setReviewNote(e.target.value)} placeholder="说明核验依据、对AI问题的判断和后续处理"/></label>{reviewError&&<div className="editor-errors">{reviewError}</div>}<div className="editor-actions"><button onClick={()=>setReviewing(null)}>取消</button><button className="primary" onClick={submitReview}>提交人工审核</button></div></section></div>}
  </>;
}
