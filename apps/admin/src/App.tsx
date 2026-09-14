import { useEffect, useMemo, useState } from 'react';
import seedCompetitions from './data/competitions.json';
import { downloadRecords, loadAdminRecords, loadAuditEntries, persistAdminRecordsWithAudit, replaceAdminRecordCache, replaceAuditCache, resetAdminRecords } from './dataStore';
import { participationFormats, registrationOrganizations, validateAdminRecord } from './validation';
import OperationModules from './OperationModules';
import CompetitionEditor from './CompetitionEditor';
import { collectChangedFields } from './editorUtils';
import ReviewPublishModule from './ReviewPublishModule';
import ProfessionMappingModule from './ProfessionMappingModule';
import { isPublishReady } from './adminWorkflow';
import { cloudEnvironmentId, connectAdminCloud, describeCloudError, disconnectAdminCloud, initializeCloudRecords } from './adminCloud';
import { hydrateOperationStores } from './operationsStore';

const statusLabels: Record<string, string> = {
  draft: '草稿', pending_system_validation: '待系统验证', pending_manual_review: '待人工核验',
  published: '已发布', reviewing: '资料复核中', archived: '已归档', offline: '已下架',
};
const pageSize = 10;

function registrationStatus(item: any) {
  if (item.schedule.status_override) return item.schedule.status_override;
  if (!item.schedule.registration_start) return '时间待公布';
  const now = new Date();
  if (now < new Date(item.schedule.registration_start)) return '即将报名';
  if (item.schedule.registration_end && now > new Date(item.schedule.registration_end)) return '已截止';
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
  const [audits, setAudits] = useState(() => loadAuditEntries());
  const [dataStatus, setDataStatus] = useState('');
  const [signupStatus, setSignupStatus] = useState('');
  const [participationFormat, setParticipationFormat] = useState('');
  const [registrationOrganization, setRegistrationOrganization] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<any | null>(null);
  const [editorErrors, setEditorErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [activeSection, setActiveSection] = useState<'competitions'|'review_publish'|'profession_mapping'|'feedback'|'ai_jobs'|'audit'>('competitions');

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
    if (dataStatus && item.dataStatus !== dataStatus) return false;
    if (signupStatus && registrationStatus(item) !== signupStatus) return false;
    if (participationFormat && item.participationFormat !== participationFormat) return false;
    if (registrationOrganization && item.registrationOrganization !== registrationOrganization) return false;
    if (keyword && ![item.name, item.editionName, item.organizer, ...(item.aliases || [])].join(' ').toLowerCase().includes(keyword.toLowerCase())) return false;
    return true;
  }), [records, dataStatus, signupStatus, participationFormat, registrationOrganization, keyword]);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const visibleRows = rows.slice((Math.min(page, pageCount) - 1) * pageSize, Math.min(page, pageCount) * pageSize);

  function saveEditor() {
    if (!editing) return;
    const errors = validateAdminRecord(editing);
    if (errors.length) { setEditorErrors(errors); return; }
    const original = records.find(item => item.id === editing.id);
    if (!original) { setEditorErrors(['未找到原始赛事记录']); return; }
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
      setEditing(null);
      setEditorErrors([]);
      setNotice('没有字段发生变化');
      return;
    }
    const preview = changedFields.slice(0, 8).join('、');
    const suffix = changedFields.length > 8 ? ` 等 ${changedFields.length} 项` : `，共 ${changedFields.length} 项`;
    if (!window.confirm(`检测到“${editing.name}”内容发生更改：\n${preview}${suffix}。\n\n是否确定保存本次更改？`)) return;
    const updated = { ...editing, updatedAt: new Date().toISOString(), updatedBy: 'admin@example.local' };
    const next = records.map(item => item.id === updated.id ? updated : item);
    setRecords(next);
    setAudits(persistAdminRecordsWithAudit(next, { action: 'update', recordId: updated.id, recordName: updated.name, changedFields, actor: 'admin@example.local' }));
    setEditing(null);
    setEditorErrors([]);
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

  if (!loggedIn) return <main className="login-shell"><section className="login-card"><div className="mark">赛</div><h1>竞赛数据管理后台</h1><p>连接 CloudBase 云数据库。管理员口令只用于调用受保护的管理云函数，不写入前端代码。</p><label>云端管理员口令<input type="password" value={adminToken} onChange={event=>setAdminToken(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!loginPending)loginAdmin()}} placeholder="请输入云函数 ADMIN_TOKEN" /></label>{loginError&&<div className="login-error">{loginError}</div>}<button disabled={loginPending||!adminToken.trim()} onClick={loginAdmin}>{loginPending?'正在连接云端…':'登录云端后台'}</button><small className="cloud-env-hint">环境：{cloudEnvironmentId()}</small></section></main>;

  return <div className="app-shell">
    <aside><div className="brand"><span>赛</span><div>竞赛数据后台<small>MVP · CloudBase</small></div></div><nav><b>赛事管理</b><button className={activeSection==='competitions'?'active':''} onClick={()=>setActiveSection('competitions')}>赛事列表</button><button className={activeSection==='review_publish'?'active':''} onClick={()=>setActiveSection('review_publish')}>审核发布</button><button className={activeSection==='profession_mapping'?'active':''} onClick={()=>setActiveSection('profession_mapping')}>专业映射</button><b>任务与反馈</b><button className={activeSection==='feedback'?'active':''} onClick={()=>setActiveSection('feedback')}>纠错审核</button><button className={activeSection==='ai_jobs'?'active':''} onClick={()=>setActiveSection('ai_jobs')}>AI失败任务</button><button className={activeSection==='audit'?'active':''} onClick={()=>setActiveSection('audit')}>操作记录</button></nav><div className={`preview-note cloud-state-${cloudSyncState}`}>数据库模式<br/>CloudBase 云数据库<br/>{cloudSyncState==='syncing'?'正在同步修改…':cloudSyncState==='error'?`同步失败：${cloudSyncError}`:'云端数据已同步'}</div></aside>
    <main className="content">{notice && <div className="save-notice top-notice">{notice}<button onClick={()=>setNotice('')}>×</button></div>}{activeSection==='competitions'?<><header><div><h1>赛事列表</h1><p>维护筛选字段、审核状态与公开缓存候选数据</p></div><div className="header-actions"><button onClick={()=>downloadRecords(records)}>导出 JSON</button><button onClick={resetLocalData}>恢复种子数据</button></div></header>
      <section className="metrics"><article><span>底稿届次</span><strong>{records.length}</strong></article><article><span>待人工核验</span><strong>{records.filter((x:any)=>x.dataStatus==='pending_manual_review').length}</strong></article><article><span>存在迁移异常</span><strong>{records.filter((x:any)=>x.qualityIssues.length>1).length}</strong></article><article><span>发布就绪</span><strong>{records.filter(isPublishReady).length}</strong></article></section>
      <section className="panel"><div className="toolbar admin-toolbar"><input value={keyword} onChange={e=>{setKeyword(e.target.value);setPage(1)}} placeholder="搜索赛事、届次、别名或主办单位"/><select value={dataStatus} onChange={e=>{setDataStatus(e.target.value);setPage(1)}}><option value="">全部数据状态</option>{Object.entries(statusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><select value={signupStatus} onChange={e=>{setSignupStatus(e.target.value);setPage(1)}}><option value="">全部报名状态</option>{['报名中','即将报名','时间待公布','已截止'].map(value=><option key={value}>{value}</option>)}</select><select value={participationFormat} onChange={e=>{setParticipationFormat(e.target.value);setPage(1)}}><option value="">全部参赛形式</option>{participationFormats.map(value=><option key={value}>{value}</option>)}</select><select value={registrationOrganization} onChange={e=>{setRegistrationOrganization(e.target.value);setPage(1)}}><option value="">全部报名组织方式</option>{registrationOrganizations.map(value=><option key={value}>{value}</option>)}</select></div>
        <div className="table-wrap"><table><thead><tr><th>赛事与届次</th><th>报名状态</th><th>更多筛选字段</th><th>数据状态</th><th>推荐</th><th>异常</th><th>最后核验</th><th>操作</th></tr></thead><tbody>{visibleRows.map((item:any)=><tr key={item.id}><td><b>{item.name}</b><small>{item.editionName}</small></td><td><span className="status">{registrationStatus(item)}</span></td><td className="filter-fields"><span>{item.participationFormat}</span><span>{item.teamSizeCategory}</span><span>{item.feeType}</span><span>{item.registrationOrganization}</span></td><td>{statusLabels[item.dataStatus]}<small>{isPublishReady(item) ? '可进入发布流程' : '发布门槛未通过'}</small></td><td>{item.recommendation.recommendation}<small>仅供参考</small></td><td>{item.qualityIssues.length} 项</td><td>{item.lastVerifiedAt?.slice(0,10) || '待核验'}</td><td><button className="link" onClick={()=>{setEditing({...item});setEditorErrors([])}}>编辑</button></td></tr>)}</tbody></table></div>
        <footer className="panel-footer"><span>显示 {rows.length} / {records.length} 条 · 第 {Math.min(page,pageCount)} / {pageCount} 页</span><div><button disabled={page<=1} onClick={()=>setPage(value=>Math.max(1,value-1))}>上一页</button><button disabled={page>=pageCount} onClick={()=>setPage(value=>Math.min(pageCount,value+1))}>下一页</button></div></footer>
      </section>
      <section className="audit-panel"><div><h2>最近操作记录</h2><p>最近100条关键写操作同步保存至 CloudBase audit_log 集合。</p></div>{audits.length ? <ul>{audits.slice(0,5).map(entry=><li key={entry.id}><b>{entry.recordName}</b><span>{entry.action === 'reset' ? '恢复种子数据' : `${entry.action} · ${entry.changedFields.join('、')}`}</span><time>{entry.createdAt.slice(0,19).replace('T',' ')}</time></li>)}</ul> : <div className="empty-audit">暂无云端操作记录</div>}</section></>:activeSection==='review_publish'?<ReviewPublishModule records={records} setRecords={setRecords} setAudits={setAudits} setNotice={setNotice} onEdit={record=>{setEditing(structuredClone(record));setEditorErrors([])}}/>:activeSection==='profession_mapping'?<ProfessionMappingModule records={records} setRecords={setRecords} setAudits={setAudits} setNotice={setNotice}/>:<OperationModules key={activeSection} section={activeSection} records={records} setRecords={setRecords} audits={audits} setAudits={setAudits} setNotice={setNotice}/>}</main>
    {editing && <CompetitionEditor editing={editing} setEditing={setEditing} errors={editorErrors} onCancel={()=>setEditing(null)} onSave={saveEditor}/>}
  </div>;
}
