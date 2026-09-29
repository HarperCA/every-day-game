import { useEffect, useMemo, useState } from 'react';
import seedCompetitions from './data/competitions.json';
import { downloadRecords, loadAdminRecords, loadAuditEntries, persistAdminRecordsWithAudit, replaceAdminRecordCache, replaceAuditCache, resetAdminRecords } from './dataStore';
import { participationFormats, registrationOrganizations, validateAdminRecord } from './validation';
import OperationModules from './OperationModules';
import CompetitionEditor from './CompetitionEditor';
import { createCompetitionDraft, validateNewCompetition } from './newCompetition';
import { saveManualRecords } from './adminCloud';
import { collectChangedFields } from './editorUtils';
import ReviewPublishModule from './ReviewPublishModule';
import ProfessionMappingModule from './ProfessionMappingModule';
import PipelineResultsModule from './PipelineResultsModule';
import WebStatsModule from './WebStatsModule';
import { isPublishReady } from './adminWorkflow';
import { cloudEnvironmentId, connectAdminCloud, describeCloudError, disconnectAdminCloud, initializeCloudRecords, type AiReviewRun } from './adminCloud';
import { hydrateOperationStores } from './operationsStore';
import { displayAuditField } from './fieldLabels';
import { prepareQuarantineRecovery, type RecoveryTarget } from './quarantineRecovery';
import './filterResultCount.css';

const statusLabels: Record<string, string> = {
  quarantined: '误收隔离（不计入比赛库）',
  draft: '草稿', pending_system_validation: '待系统验证', pending_manual_review: '待人工核验',
  published: '已发布', reviewing: '资料复核中', archived: '已归档', offline: '已下架',
};
const pageSize = 10;

function registrationStatus(item: any) {
  if (item.schedule.status_override) return item.schedule.status_override;
  const now = new Date();
  if (item.schedule.registration_end && now > new Date(item.schedule.registration_end)) return '已截止';
  if (!item.schedule.registration_start) return item.schedule.pending_announcement ? '时间待公布' : '时间未核实';
  if (now < new Date(item.schedule.registration_start)) return '即将报名';
  return '报名中';
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [adminToken, setAdminToken] = useState('');
  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [cloudSyncState, setCloudSyncState] = useState<'synced'|'syncing'|'error'>('synced');
  const [cloudSyncError, setCloudSyncError] = useState('');
  const [records, setRecords] = useState<any[]>(() => loadAdminRecords(seedCompetitions as any[]));
  const [rawAudits, setAudits] = useState(() => loadAuditEntries());
  const audits = rawAudits.map(entry => ({ ...entry, changedFields:entry.changedFields.map(displayAuditField) }));
  const [lastAiReviewRun, setLastAiReviewRun] = useState<AiReviewRun | null>(null);
  const [dataStatus, setDataStatus] = useState('');
  const [signupStatus, setSignupStatus] = useState('');
  const [participationFormat, setParticipationFormat] = useState('');
  const [registrationOrganization, setRegistrationOrganization] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<any | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingPending, setCreatingPending] = useState(false);
  const [editingOriginalName, setEditingOriginalName] = useState('');
  const [editorErrors, setEditorErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [activeSection, setActiveSection] = useState<'competitions'|'review_publish'|'profession_mapping'|'pipeline_results'|'web_stats'|'feedback'|'ai_jobs'|'audit'>('competitions');

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      setCloudSyncState(detail.state || 'error');
      setCloudSyncError(detail.message || '');
    };
    window.addEventListener('admin-cloud-sync', listener);
    return () => window.removeEventListener('admin-cloud-sync', listener);
  }, []);

  const rows = useMemo(() => records.filter((item: any) => {
    if (!dataStatus && item.dataStatus === 'quarantined') return false;
    if (dataStatus && item.dataStatus !== dataStatus) return false;
    if (signupStatus && registrationStatus(item) !== signupStatus) return false;
    if (participationFormat && item.participationFormat !== participationFormat) return false;
    if (registrationOrganization && item.registrationOrganization !== registrationOrganization) return false;
    if (keyword && ![item.name, item.editionName, item.organizer, ...(item.aliases || [])].join(' ').toLowerCase().includes(keyword.toLowerCase())) return false;
    return true;
  }), [records, dataStatus, signupStatus, participationFormat, registrationOrganization, keyword]);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const visibleRows = rows.slice((Math.min(page, pageCount) - 1) * pageSize, Math.min(page, pageCount) * pageSize);

  function openEditor(index: number) {
    setCreating(false);
    const record = records[index];
    if (!record) return;
    setEditing(structuredClone(record));
    setEditingIndex(index);
    setEditingOriginalName(record.name);
    setEditorErrors([]);
  }

  function closeEditor() {
    if (creatingPending) return;
    setCreating(false);
    setEditing(null);
    setEditingIndex(null);
    setEditingOriginalName('');
    setEditorErrors([]);
  }

  function deleteEditor() {
    if (!editing || editingIndex === null) return;
    const original = records[editingIndex];
    if (!original || original.id !== editing.id || original.name !== editingOriginalName) {
      setEditorErrors(['赛事已发生变化，请重新打开编辑窗口']);
      return;
    }
    if (!window.confirm(`确定彻底删除“${original.name}”吗？\n删除后将从比赛库及公开展示中移除，无法通过后台恢复。`)) return;
    const next = records.filter((_, index) => index !== editingIndex);
    setRecords(next);
    setAudits(persistAdminRecordsWithAudit(next, {
      action:'delete', recordId:original.id, recordName:original.name,
      changedFields:['record_removed'], actor:'admin@example.local',
      reason:'管理员在赛事编辑窗口确认弹窗后，彻底移除该条记录',
    }));
    closeEditor();
    setNotice(`${original.name} 已提交从比赛库移除`);
  }

  async function recoverEditor(target: RecoveryTarget) {
    if (!editing || editingIndex === null || creatingPending) return;
    const original = records[editingIndex];
    if (!original || original.id !== editing.id || original.name !== editingOriginalName || original.dataStatus !== 'quarantined') {
      setEditorErrors(['隔离记录已发生变化，请刷新后台后重新打开']);
      return;
    }
    let updated: any;
    try { updated = prepareQuarantineRecovery(editing, target); }
    catch (error) { setEditorErrors([describeCloudError(error)]); return; }
    const label = target === 'draft' ? '返回草稿' : target === 'published' ? '直接发布' : '归档';
    if (!window.confirm(`确定将“${original.name}”从误收隔离中${label}吗？\n原隔离原因：${original.quarantine?.reason || '未记录'}\n这会保留处置审计；发布后会同步到公开赛事数据。`)) return;
    const next = records.map((record,index) => index === editingIndex ? updated : record);
    const audit = { id:`audit-${crypto.randomUUID()}`, action:'recover_quarantine', objectType:'event_edition',
      recordId:updated.id, recordName:updated.name, changedFields:collectChangedFields(original,updated),
      actor:'manual_admin', reason:`管理员复核误收隔离后${label}；原原因：${original.quarantine?.reason || '未记录'}`,
      createdAt:new Date().toISOString() };
    setCreatingPending(true);
    try {
      const saved = await saveManualRecords(next,audit);
      setRecords(next); replaceAdminRecordCache(next);
      const nextAudits = [audit,...audits]; setAudits(nextAudits); replaceAuditCache(nextAudits);
      setEditing(null); setEditingIndex(null); setEditorErrors([]); setPage(1); setDataStatus(target);
      setNotice((target === 'published' || target === 'archived') && !saved.publicCachePublished
        ? `${updated.name} 状态已保存，但公开缓存未报告同步成功，请立即核查`
        : `${updated.name} 已由管理员${label}${target === 'published' ? '，公开缓存已同步' : ''}`);
    } catch (error) { setEditorErrors([describeCloudError(error)]); }
    finally { setCreatingPending(false); }
  }

  async function saveEditor() {
    if (!editing) return;
    if (creatingPending) return;
    if (creating) {
      const errors = [...validateAdminRecord(editing), ...validateNewCompetition(editing, records)];
      if (errors.length) { setEditorErrors(errors); return; }
      if (!window.confirm(`确定将“${editing.name}”新增到比赛库吗？\n将保存为草稿，审核通过后才能发布。`)) return;
      setCreatingPending(true);
      const record = { ...editing, dataStatus: 'draft', systemValidation: 'not_run', manualReview: 'pending',
        recommendation: { ...editing.recommendation, system_validation: 'not_run', manual_review: 'pending', published_cache: false },
        updatedAt: new Date().toISOString(), updatedBy: 'manual_admin' };
      const next = [record, ...records];
      const audit = { id: `audit-${crypto.randomUUID()}`, action: 'create', objectType: 'event_edition', recordId: record.id,
        recordName: record.name, changedFields: ['record_created'], actor: 'manual_admin', reason: '管理员手动新增比赛', createdAt: new Date().toISOString() };
      try {
        await saveManualRecords(next, audit);
        setRecords(next); replaceAdminRecordCache(next);
        const nextAudits = [audit, ...audits]; setAudits(nextAudits); replaceAuditCache(nextAudits);
        setEditing(null); setCreating(false); setEditorErrors([]);
        setKeyword(''); setDataStatus(''); setSignupStatus(''); setParticipationFormat(''); setRegistrationOrganization(''); setPage(1);
        setNotice(`已新增“${record.name}”到比赛库，状态为草稿`);
      } catch (error) { setEditorErrors([describeCloudError(error)]); }
      finally { setCreatingPending(false); }
      return;
    }
    const errors = validateAdminRecord(editing);
    if (errors.length) { setEditorErrors(errors); return; }
    const original = editingIndex === null ? null : records[editingIndex];
    if (!original || original.id !== editing.id || original.name !== editingOriginalName) { setEditorErrors(['赛事已发生变化，请重新打开编辑窗口']); return; }
    if (original.dataStatus !== editing.dataStatus && (original.dataStatus === 'published' || editing.dataStatus === 'published')) {
      setEditorErrors(['发布和下架只能在“审核发布”模块执行']);
      return;
    }
    if (original.systemValidation !== editing.systemValidation || original.manualReview !== editing.manualReview || original.recommendation?.published_cache !== editing.recommendation?.published_cache) {
      setEditorErrors(['系统验证、人工审核和公开缓存状态只能由“审核发布”流程更新']);
      return;
    }
    const changedFields = collectChangedFields(original, editing);
    if (!changedFields.length) {
      closeEditor();
      setNotice('没有字段发生变化');
      return;
    }
    const preview = changedFields.slice(0, 8).join('、');
    const suffix = changedFields.length > 8 ? ` 等 ${changedFields.length} 项` : `，共 ${changedFields.length} 项`;
    if (!window.confirm(`检测到“${editing.name}”内容发生更改：\n${preview}${suffix}。\n\n是否确定保存本次更改？`)) return;
    const updated = { ...editing, updatedAt: new Date().toISOString(), updatedBy: 'admin@example.local' };
    const next = records.map((item, index) => index === editingIndex ? updated : item);
    setRecords(next);
    setAudits(persistAdminRecordsWithAudit(next, { action: 'update', recordId: updated.id, recordName: updated.name, changedFields, actor: 'admin@example.local' }));
    closeEditor();
    setNotice(`已保存 ${updated.name} 的 ${changedFields.length} 项修改`);
  }

  function resetLocalData() {
    if (!window.confirm('确定将云端后台数据恢复为30场种子数据吗？该操作会覆盖当前赛事修改。')) return;
    setRecords(resetAdminRecords(seedCompetitions as any[]));
    setAudits(loadAuditEntries());
    setNotice('已恢复种子数据');
  }

  async function loginAdmin() {
    setLoginPending(true);
    setLoginError('');
    try {
      const bootstrap = await connectAdminCloud(adminToken);
      const cloudRecords = bootstrap.records.length ? bootstrap.records : (seedCompetitions as any[]);
      if (!bootstrap.records.length) await initializeCloudRecords(cloudRecords);
      setRecords(cloudRecords);
      replaceAdminRecordCache(cloudRecords);
      setAudits(bootstrap.audits);
      replaceAuditCache(bootstrap.audits);
      hydrateOperationStores(bootstrap.feedbacks, bootstrap.aiJobs);
      setLastAiReviewRun(bootstrap.lastAiReviewRun ?? null);
      setLoggedIn(true);
      setCloudSyncState('synced');
    } catch (error) {
      console.error('CloudBase admin login failed', error);
      disconnectAdminCloud();
      setLoginError(describeCloudError(error));
    } finally {
      setLoginPending(false);
    }
  }

  if (!loggedIn) return <main className="login-shell"><section className="login-card"><div className="mark">赛</div><h1>竞赛数据管理后台</h1><p>连接自有服务器数据库。管理员口令只用于调用受保护的接口，不写入前端代码。</p><label>管理员口令<input type="password" value={adminToken} onChange={event=>setAdminToken(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!loginPending)loginAdmin()}} placeholder="请输入 ADMIN_TOKEN" /></label>{loginError&&<div className="login-error">{loginError}</div>}<button disabled={loginPending||!adminToken.trim()} onClick={loginAdmin}>{loginPending?'正在连接…':'登录后台'}</button><small className="cloud-env-hint">接口：{cloudEnvironmentId()}</small></section></main>;

  return <div className="app-shell">
    <aside><div className="brand"><span>赛</span><div>竞赛数据后台<small>MVP · CloudBase</small></div></div><nav><b>赛事管理</b><button className={activeSection==='competitions'?'active':''} onClick={()=>setActiveSection('competitions')}>赛事列表</button><button className={activeSection==='review_publish'?'active':''} onClick={()=>setActiveSection('review_publish')}>审核发布</button><button className={activeSection==='profession_mapping'?'active':''} onClick={()=>setActiveSection('profession_mapping')}>专业映射</button><b>任务与反馈</b><button className={activeSection==='pipeline_results'?'active':''} onClick={()=>setActiveSection('pipeline_results')}>抓取结果账</button><button className={activeSection==='web_stats'?'active':''} onClick={()=>setActiveSection('web_stats')}>测试版统计</button><button className={activeSection==='feedback'?'active':''} onClick={()=>setActiveSection('feedback')}>纠错审核</button><button className={activeSection==='ai_jobs'?'active':''} onClick={()=>setActiveSection('ai_jobs')}>AI失败任务</button><button className={activeSection==='audit'?'active':''} onClick={()=>setActiveSection('audit')}>操作记录</button></nav><div className={`preview-note cloud-state-${cloudSyncState}`}>数据库模式<br/>CloudBase 云数据库<br/>{cloudSyncState==='syncing'?'正在同步修改…':cloudSyncState==='error'?`同步失败：${cloudSyncError}`:'云端数据已同步'}</div></aside>
    <main className="content">{notice && <div className="save-notice top-notice">{notice}<button onClick={()=>setNotice('')}>×</button></div>}{activeSection==='competitions'?<><header><div><h1>赛事列表</h1><p>维护筛选字段、审核状态与公开缓存候选数据</p></div><div className="header-actions"><button className="primary" disabled={cloudSyncState !== 'synced'} onClick={()=>{setCreating(true);setEditingIndex(null);setEditingOriginalName('');setEditorErrors([]);setEditing(createCompetitionDraft());}}>新增比赛</button><button onClick={()=>downloadRecords(records)}>导出 JSON</button><button onClick={resetLocalData}>恢复种子数据</button></div></header>
      <section className="metrics"><article><span>底稿届次</span><strong>{records.length}</strong></article><article><span>待人工核验</span><strong>{records.filter((x:any)=>x.dataStatus==='pending_manual_review').length}</strong></article><article><span>存在迁移异常</span><strong>{records.filter((x:any)=>x.qualityIssues.length>1).length}</strong></article><article><span>发布就绪</span><strong>{records.filter(isPublishReady).length}</strong></article></section>
      <section className="panel"><div className="toolbar admin-toolbar"><input value={keyword} onChange={e=>{setKeyword(e.target.value);setPage(1)}} placeholder="搜索赛事、届次、别名或主办单位"/><output className="filter-result-count" aria-live="polite">{rows.length} 条</output><select value={dataStatus} onChange={e=>{setDataStatus(e.target.value);setPage(1)}}><option value="">全部数据状态</option>{Object.entries(statusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><select value={signupStatus} onChange={e=>{setSignupStatus(e.target.value);setPage(1)}}><option value="">全部报名状态</option>{['报名中','即将报名','时间待公布','已截止'].map(value=><option key={value}>{value}</option>)}</select><select value={participationFormat} onChange={e=>{setParticipationFormat(e.target.value);setPage(1)}}><option value="">全部参赛形式</option>{participationFormats.map(value=><option key={value}>{value}</option>)}</select><select value={registrationOrganization} onChange={e=>{setRegistrationOrganization(e.target.value);setPage(1)}}><option value="">全部报名组织方式</option>{registrationOrganizations.map(value=><option key={value}>{value}</option>)}</select></div>
        <div className="table-wrap"><table><thead><tr><th>赛事与届次</th><th>报名状态</th><th>更多筛选字段</th><th>数据状态</th><th>推荐</th><th>异常</th><th>最后核验</th><th>操作</th></tr></thead><tbody>{visibleRows.map((item:any)=><tr key={`${item.id}-${records.indexOf(item)}`}><td><b>{item.name}</b><small>{item.editionName}</small></td><td><span className="status">{registrationStatus(item)}</span></td><td className="filter-fields"><span>{item.participationFormat}</span><span>{item.teamSizeCategory}</span><span>{item.feeType}</span><span>{item.registrationOrganization}</span></td><td>{statusLabels[item.dataStatus]}<small>{isPublishReady(item) ? '可进入发布流程' : '发布门槛未通过'}</small></td><td>{item.recommendation.recommendation}<small>仅供参考</small></td><td>{item.qualityIssues.length} 项</td><td>{item.lastVerifiedAt?.slice(0,10) || '待核验'}</td><td><button className="link" onClick={()=>openEditor(records.indexOf(item))}>编辑</button></td></tr>)}</tbody></table></div>
        <footer className="panel-footer"><span>显示 {rows.length} / {records.length} 条 · 第 {Math.min(page,pageCount)} / {pageCount} 页</span><div><button disabled={page<=1} onClick={()=>setPage(value=>Math.max(1,value-1))}>上一页</button><button disabled={page>=pageCount} onClick={()=>setPage(value=>Math.min(pageCount,value+1))}>下一页</button></div></footer>
      </section>
      <section className="audit-panel"><div><h2>最近操作记录</h2><p>最近100条关键写操作同步保存至 CloudBase audit_log 集合。</p></div>{audits.length ? <ul>{audits.slice(0,5).map(entry=><li key={entry.id}><b>{entry.recordName}</b><span>{entry.action === 'reset' ? '恢复种子数据' : `${entry.action} · ${entry.changedFields.join('、')}`}</span><time>{entry.createdAt.slice(0,19).replace('T',' ')}</time></li>)}</ul> : <div className="empty-audit">暂无云端操作记录</div>}</section></>:activeSection==='review_publish'?<ReviewPublishModule records={records} setRecords={setRecords} setAudits={setAudits} setNotice={setNotice} lastAiReviewRun={lastAiReviewRun} onEdit={(_record,index)=>openEditor(index)}/>:activeSection==='profession_mapping'?<ProfessionMappingModule records={records} setRecords={setRecords} setAudits={setAudits} setNotice={setNotice}/>:activeSection==='pipeline_results'?<PipelineResultsModule/>:activeSection==='web_stats'?<WebStatsModule/>:<OperationModules key={activeSection} section={activeSection} records={records} setRecords={setRecords} audits={audits} setAudits={setAudits} setNotice={setNotice}/>}</main>
    {editing && <CompetitionEditor editing={editing} setEditing={setEditing} errors={editorErrors} onCancel={closeEditor} onSave={saveEditor} onDelete={deleteEditor} onRecover={recoverEditor} isNew={creating} saving={creatingPending}/>}
  </div>;
}
