import { useEffect, useMemo, useState } from 'react';
import seedCompetitions from './data/competitions.json';
import { downloadRecords, loadAdminRecords, loadAuditEntries, mergeSeedSourceContext, saveAdminRecordsWithAudit, replaceAdminRecordCache, replaceAuditCache } from './dataStore';
import { participationFormats, registrationOrganizations, validateAdminRecord } from './validation';
import OperationModules from './OperationModules';
import GeneralFeedbackModule from './GeneralFeedbackModule';
import CompetitionEditor from './CompetitionEditor';
import { createCompetitionDraft, validateNewCompetition } from './newCompetition';
import { saveManualRecords } from './adminCloud';
import { collectChangedFields } from './editorUtils';
import ReviewPublishModule from './ReviewPublishModule';
import ProfessionMappingModule from './ProfessionMappingModule';
import PipelineResultsModule from './PipelineResultsModule';
import CompetitionOverviewModule from './CompetitionOverviewModule';
import ClientIssuesModule from './ClientIssuesModule';
import PreferenceStatsModule from './PreferenceStatsModule';
import ApiUsageModule from './ApiUsageModule';
import SiteBlocklistModule from './SiteBlocklistModule';
import { getPublishBlockers, isPublishReady } from './adminWorkflow';
import { registrationInstant } from './registrationSchedule';
import { cloudEnvironmentId, connectAdminCloud, describeCloudError, disconnectAdminCloud, type AiReviewRun } from './adminCloud';
import { hydrateOperationStores } from './operationsStore';
import { displayAuditField } from './fieldLabels';
import { prepareQuarantineRecovery, type RecoveryTarget } from './quarantineRecovery';
import { competitionRegion } from './competitionRegion';
import './filterResultCount.css';
import './aiThinking.css';

const statusLabels: Record<string, string> = {
  quarantined: '误收隔离（不计入比赛库）',
  draft: '草稿', pending_system_validation: '待系统验证', pending_manual_review: '待人工核验',
  published: '已发布', reviewing: '资料复核中', archived: '已归档', offline: '已下架',
};
const pageSize = 10;

function registrationStatus(item: any) {
  if (item.dataStatus === 'archived') return '已截止';
  if (item.schedule?.status_override) return item.schedule.status_override;
  const now = Date.now();
  const start = registrationInstant(item.schedule?.registration_start, 'start');
  const end = registrationInstant(item.schedule?.registration_end, 'end');
  if ((start !== null && !Number.isFinite(start)) || (end !== null && !Number.isFinite(end))) return '时间未核实';
  if (end !== null && now > end) return '已截止';
  if (start === null) return item.schedule?.pending_announcement ? '时间待公布' : '时间未核实';
  if (now < start) return '即将报名';
  if (end === null) return '时间待公布';
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
  const [region, setRegion] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<any | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingPending, setCreatingPending] = useState(false);
  const [editingOriginalName, setEditingOriginalName] = useState('');
  const [editorErrors, setEditorErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [activeSection, setActiveSection] = useState<'competitions'|'review_publish'|'profession_mapping'|'competition_overview'|'pipeline_results'|'client_issues'|'preference_stats'|'api_usage'|'site_blocklist'|'feedback'|'general_feedback'|'ai_jobs'|'audit'>('competitions');

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
    if (region && competitionRegion(item) !== region) return false;
    if (keyword && ![item.name, item.editionName, item.organizer, ...(item.aliases || [])].join(' ').toLowerCase().includes(keyword.toLowerCase())) return false;
    return true;
  }), [records, dataStatus, signupStatus, participationFormat, registrationOrganization, region, keyword]);
  const regionOptions = useMemo(() => [...new Set(records.map(competitionRegion).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN')), [records]);
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

  async function deleteEditor() {
    if (!editing || editingIndex === null || creatingPending) return;
    const original = records[editingIndex];
    if (!original || original.id !== editing.id || original.name !== editingOriginalName) {
      setEditorErrors(['赛事已发生变化，请重新打开编辑窗口']);
      return;
    }
    if (!window.confirm(`确定彻底删除“${original.name}”吗？\n删除后将从比赛库及公开展示中移除，无法通过后台恢复。`)) return;
    const next = records.filter((_, index) => index !== editingIndex);
    setCreatingPending(true);
    try {
      const nextAudits = await saveAdminRecordsWithAudit(next, {
        action:'delete',recordId:original.id,recordName:original.name,
        changedFields:['record_removed'],actor:'admin@example.local',
        reason:'管理员在赛事编辑窗口确认弹窗后，彻底移除该条记录',
      });
      setRecords(next);setAudits(nextAudits);closeEditor();
      setNotice(`${original.name} 已从比赛库移除`);
    } catch(error) {setEditorErrors([describeCloudError(error)]);}
    finally {setCreatingPending(false);}
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
    setCreatingPending(true);
    const audit = { id:`audit-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, action:'update', recordId:updated.id, recordName:updated.name, changedFields, actor:'admin@example.local', createdAt:new Date().toISOString() };
    try {
      await saveManualRecords(next, audit);
      setRecords(next);
      replaceAdminRecordCache(next);
      const nextAudits = [audit, ...audits].slice(0,100);
      setAudits(nextAudits);
      replaceAuditCache(nextAudits);
      closeEditor();
      setNotice(`已保存 ${updated.name} 的 ${changedFields.length} 项修改`);
    } catch (error) { setEditorErrors([describeCloudError(error)]); }
    finally { setCreatingPending(false); }
  }

  async function resetLocalData() {
    if (creatingPending) return;
    if (!window.confirm('确定将云端后台数据恢复为30场种子数据吗？该操作会覆盖当前赛事修改。')) return;
    setCreatingPending(true);
    try {
      const next = (seedCompetitions as any[]).map(item=>({...item}));
      const nextAudits = await saveAdminRecordsWithAudit(next,{action:'reset',recordId:'*',recordName:'全部赛事',changedFields:['records'],actor:'admin@example.local'});
      setRecords(next);setAudits(nextAudits);setNotice('已恢复种子数据');
    } catch(error) {setNotice(`恢复失败：${describeCloudError(error)}`);}
    finally {setCreatingPending(false);}
  }

  async function loginAdmin() {
    setLoginPending(true);
    setLoginError('');
    try {
      const bootstrap = await connectAdminCloud(adminToken);
      const cloudRecords = mergeSeedSourceContext(bootstrap.records, seedCompetitions as any[]);
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
    <aside><div className="brand"><span>赛</span><div>竞赛数据后台<small>MVP · CloudBase</small></div></div><nav><b>赛事管理</b><button className={activeSection==='competitions'?'active':''} onClick={()=>setActiveSection('competitions')}>赛事列表</button><button className={activeSection==='review_publish'?'active':''} onClick={()=>setActiveSection('review_publish')}>审核发布</button><button className={activeSection==='profession_mapping'?'active':''} onClick={()=>setActiveSection('profession_mapping')}>专业映射</button><button className={activeSection==='competition_overview'?'active':''} onClick={()=>setActiveSection('competition_overview')}>比赛数据总览</button><b>任务与反馈</b><button className={activeSection==='pipeline_results'?'active':''} onClick={()=>setActiveSection('pipeline_results')}>抓取结果账</button><button className={activeSection==='client_issues'?'active':''} onClick={()=>setActiveSection('client_issues')}>访问异常</button><button className={activeSection==='preference_stats'?'active':''} onClick={()=>setActiveSection('preference_stats')}>问卷统计</button><button className={activeSection==='api_usage'?'active':''} onClick={()=>setActiveSection('api_usage')}>接口用量</button><button className={activeSection==='site_blocklist'?'active':''} onClick={()=>setActiveSection('site_blocklist')}>屏蔽网站</button><button className={activeSection==='general_feedback'?'active':''} onClick={()=>setActiveSection('general_feedback')}>意见反馈</button><button className={activeSection==='feedback'?'active':''} onClick={()=>setActiveSection('feedback')}>纠错审核</button><button className={activeSection==='ai_jobs'?'active':''} onClick={()=>setActiveSection('ai_jobs')}>AI失败任务</button><button className={activeSection==='audit'?'active':''} onClick={()=>setActiveSection('audit')}>操作记录</button></nav><div className={`preview-note cloud-state-${cloudSyncState}`}>数据库模式<br/>CloudBase 云数据库<br/>{cloudSyncState==='syncing'?'正在同步修改…':cloudSyncState==='error'?`同步失败：${cloudSyncError}`:'云端数据已同步'}</div></aside>
    <main className="content">{notice && <div className="save-notice top-notice">{notice}<button onClick={()=>setNotice('')}>×</button></div>}{activeSection==='competitions'?<><header><div><h1>赛事列表</h1><p>维护筛选字段、审核状态与公开缓存候选数据</p></div><div className="header-actions"><button className="primary" disabled={cloudSyncState !== 'synced'} onClick={()=>{setCreating(true);setEditingIndex(null);setEditingOriginalName('');setEditorErrors([]);setEditing(createCompetitionDraft());}}>新增比赛</button><button onClick={()=>downloadRecords(records)}>导出 JSON</button><button onClick={resetLocalData}>恢复种子数据</button></div></header>
      <section className="metrics"><article><span>全部届次记录</span><strong>{records.length}</strong></article><article><span>待人工核验</span><strong>{records.filter((x:any)=>x.dataStatus==='pending_manual_review').length}</strong></article><article><span>质量问题 ≥ 2 项</span><strong>{records.filter((x:any)=>(x.qualityIssues || []).length>1).length}</strong></article><article><span>发布就绪</span><strong>{records.filter((x:any)=>!['published','archived','quarantined'].includes(x.dataStatus) && isPublishReady(x)).length}</strong></article></section>
      <details className="admin-data-guide"><summary>这些统计和数据状态是什么意思？</summary><div><h3>顶部统计</h3><dl><dt>全部届次记录</dt><dd>当前数据库里的记录总数，每一届单独计数；包含草稿、已发布、已归档、已下架和误收隔离，不等于真实有效比赛数。</dd><dt>待人工核验</dt><dd>数据状态为“待人工核验”的记录数；表示等待人阅读官方原文并确认，不能仅凭 AI 建议通过。</dd><dt>质量问题 ≥ 2 项</dt><dd>质量问题列表里至少有两项的记录数。问题可能是来源、时间、赛项拆分等，不一定是数据迁移造成的。</dd><dt>发布就绪</dt><dd>未发布、未归档、未隔离且当前发布门槛全部通过的记录数；仍需确认云端保存和公开缓存同步成功。</dd></dl><h3>数据状态筛选</h3><dl><dt>全部数据状态</dt><dd>不按状态过滤，显示所有届次记录，包括误收隔离。</dd><dt>误收隔离（不计入比赛库）</dt><dd>怀疑或确认是非赛事、重复或严重失实，暂时隔离并保留原数据与审计；不进入小程序公开列表，须人工处置后恢复。</dd><dt>草稿</dt><dd>新建或自动采集后的待核查记录；身份、官网、报名时间等资料尚未走完发布审核。</dd><dt>待系统验证</dt><dd>等待运行系统规则，或规则发现问题后等待修改并重跑；具体结果还要看“系统验证”字段。</dd><dt>待人工核验</dt><dd>进入人工审查阶段；管理员需要核对官方页面、赛事名称与届次、报名时间和入口。</dd><dt>已发布</dt><dd>通过发布流程、准备进入公开缓存的当届记录；实际小程序展示还取决于云端同步是否成功。</dd><dt>资料复核中</dt><dd>收到纠错或复查线索，资料需要重新核对；修改完成后再走审核流程。</dd><dt>已归档</dt><dd>往届或已结束的记录，保留历史资料；小程序如展示该届，应标为已截止。</dd><dt>已下架</dt><dd>管理员主动撤下的记录，不再作为公开赛事展示；重新发布须重新通过门槛。</dd></dl></div></details>
      <section className="panel"><div className="toolbar admin-toolbar"><input value={keyword} onChange={e=>{setKeyword(e.target.value);setPage(1)}} placeholder="搜索赛事、届次、别名或主办单位"/><output className="filter-result-count" aria-live="polite">{rows.length} 条</output><select value={dataStatus} onChange={e=>{setDataStatus(e.target.value);setPage(1)}}><option value="">全部数据状态</option>{Object.entries(statusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><select value={signupStatus} onChange={e=>{setSignupStatus(e.target.value);setPage(1)}}><option value="">全部报名状态</option>{['报名中','即将报名','时间待公布','已截止'].map(value=><option key={value}>{value}</option>)}</select><select value={participationFormat} onChange={e=>{setParticipationFormat(e.target.value);setPage(1)}}><option value="">全部参赛形式</option>{participationFormats.map(value=><option key={value}>{value}</option>)}</select><select value={registrationOrganization} onChange={e=>{setRegistrationOrganization(e.target.value);setPage(1)}}><option value="">全部报名组织方式</option>{registrationOrganizations.map(value=><option key={value}>{value}</option>)}</select><select value={region} onChange={e=>{setRegion(e.target.value);setPage(1)}}><option value="">全部赛事地区</option>{regionOptions.map(value=><option key={value}>{value}</option>)}</select></div>
        <div className="table-wrap"><table><thead><tr><th>赛事与届次</th><th>报名状态</th><th>更多筛选字段</th><th>数据状态</th><th>推荐</th><th>异常</th><th>最后核验</th><th>操作</th></tr></thead><tbody>{visibleRows.map((item:any)=><tr key={`${item.id}-${records.indexOf(item)}`}><td><b>{item.name}</b><small>{item.editionName}</small></td><td><span className="status">{registrationStatus(item)}</span></td><td className="filter-fields"><span>{item.participationFormat}</span><span>{item.teamSizeCategory}</span><span>{item.feeType}</span><span>{item.registrationOrganization}</span></td><td>{statusLabels[item.dataStatus]}<small>{item.dataStatus === 'quarantined' ? `隔离原因：${item.quarantine?.reason || '未记录，请核对处置审计'}` : ['published', 'archived'].includes(item.dataStatus) ? '' : isPublishReady(item) ? '可进入发布流程' : (() => { const blockers = getPublishBlockers(item); return `${blockers.slice(0, 2).join('；')}${blockers.length > 2 ? `；另有 ${blockers.length - 2} 项` : ''}`; })()}</small></td><td>{item.recommendation.recommendation}</td><td>{item.qualityIssues.length} 项</td><td>{item.lastVerifiedAt?.slice(0,10) || '待核验'}</td><td><button className="link" onClick={()=>openEditor(records.indexOf(item))}>编辑</button></td></tr>)}</tbody></table></div>
        <footer className="panel-footer"><span>显示 {rows.length} / {records.length} 条 · 第 {Math.min(page,pageCount)} / {pageCount} 页</span><div><button disabled={page<=1} onClick={()=>setPage(value=>Math.max(1,value-1))}>上一页</button><button disabled={page>=pageCount} onClick={()=>setPage(value=>Math.min(pageCount,value+1))}>下一页</button></div></footer>
      </section>
      <section className="audit-panel"><div><h2>最近操作记录</h2><p>最近100条关键写操作同步保存至 CloudBase audit_log 集合。</p></div>{audits.length ? <ul>{audits.slice(0,5).map(entry=><li key={entry.id}><b>{entry.recordName}</b><span>{entry.action === 'reset' ? '恢复种子数据' : `${entry.action} · ${entry.changedFields.join('、')}`}</span><time>{entry.createdAt.slice(0,19).replace('T',' ')}</time></li>)}</ul> : <div className="empty-audit">暂无云端操作记录</div>}</section></>:activeSection==='review_publish'?<ReviewPublishModule records={records} setRecords={setRecords} setAudits={setAudits} setNotice={setNotice} lastAiReviewRun={lastAiReviewRun} onEdit={(_record,index)=>openEditor(index)}/>:activeSection==='profession_mapping'?<ProfessionMappingModule records={records} setRecords={setRecords} setAudits={setAudits} setNotice={setNotice}/>:activeSection==='competition_overview'?<CompetitionOverviewModule records={records}/>:activeSection==='pipeline_results'?<PipelineResultsModule/>:activeSection==='client_issues'?<ClientIssuesModule/>:activeSection==='preference_stats'?<PreferenceStatsModule/>:activeSection==='api_usage'?<ApiUsageModule/>:activeSection==='site_blocklist'?<SiteBlocklistModule/>:activeSection==='general_feedback'?<GeneralFeedbackModule/>:<OperationModules key={activeSection} section={activeSection} records={records} setRecords={setRecords} audits={audits} setAudits={setAudits} setNotice={setNotice}/>}</main>
    {editing && <CompetitionEditor editing={editing} setEditing={setEditing} errors={editorErrors} onCancel={closeEditor} onSave={saveEditor} onDelete={deleteEditor} onRecover={recoverEditor} isNew={creating} saving={creatingPending}/>}
  </div>;
}
