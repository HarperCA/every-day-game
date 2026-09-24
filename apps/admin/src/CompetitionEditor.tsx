import type { Dispatch, SetStateAction } from 'react';
import { feeTypes, participationFormats, registrationOrganizations, teamSizeCategories } from './validation';
import { fromDateTimeLocal, linesToList, listToLines, toDateTimeLocal } from './editorUtils';
import { displayAuditField } from './fieldLabels';

const dataStatuses = ['draft', 'pending_system_validation', 'pending_manual_review', 'reviewing', 'published', 'archived', 'offline', 'quarantined'];
const dataStatusLabels: Record<string, string> = { draft:'草稿', pending_system_validation:'待系统验证', pending_manual_review:'待人工核验', reviewing:'资料复核中', published:'已发布', archived:'已归档', offline:'已下架' };
const validationStatuses = ['not_run', 'passed', 'failed'];
dataStatusLabels.quarantined = '误收隔离（补齐资料后可恢复草稿）';
const validationLabels: Record<string, string> = { not_run:'未执行', passed:'通过', failed:'未通过' };
const manualStatuses = ['pending', 'passed', 'rejected'];
const manualLabels: Record<string, string> = { pending:'待审核', passed:'通过', rejected:'驳回' };

interface Props {
  editing: any;
  setEditing: Dispatch<SetStateAction<any | null>>;
  errors: string[];
  onCancel: () => void;
  onSave: () => void;
  onDelete: () => void;
  isNew?: boolean;
  saving?: boolean;
}

export default function CompetitionEditor({ editing, setEditing, errors, onCancel, onSave, onDelete, isNew = false, saving = false }: Props) {
  const set = (field: string, value: unknown) => setEditing((current: any) => ({ ...current, [field]: value }));
  const setNested = (group: string, field: string, value: unknown) => setEditing((current: any) => ({ ...current, [group]: { ...current[group], [field]: value } }));
  const updateSource = (index: number, field: string, value: unknown) => setEditing((current: any) => ({
    ...current,
    sources: current.sources.map((source: any, sourceIndex: number) => sourceIndex === index ? { ...source, [field]: value } : source),
  }));
  const removeSource = (index: number) => setEditing((current: any) => ({ ...current, sources: current.sources.filter((_: any, sourceIndex: number) => sourceIndex !== index) }));
  const addSource = () => setEditing((current: any) => ({
    ...current,
    sources: [...(current.sources || []), { id:`source-${current.id}-${Date.now()}`, edition_id:current.id, url:'', source_type:'organizer_website', is_official:true, published_at:null, last_verified_at:null, validity_status:'unchecked' }],
  }));

  return <div className="modal-mask" onMouseDown={onCancel}>
    <section className="editor-modal full-editor" onMouseDown={event=>event.stopPropagation()}>
      <div className="editor-head"><div><h2>{isNew ? '手动新增比赛' : '编辑赛事全部内容'}</h2><p>{isNew ? '填写实际比赛名称、届次、主办方、大学生资格、专业规则及来源；保存为草稿，审核后发布。' : `${editing.name} · ${editing.editionName}`}</p></div><button className="modal-close" onClick={onCancel}>×</button></div>
      <div className="editor-note">管理员可修改全部业务内容。赛事 ID、届次 ID 等关联主键只读，避免破坏数据库关联；保存前会展示二次确认。</div>
      {errors.length>0&&<div className="editor-errors">{errors.map(error=><div key={error}>· {error}</div>)}</div>}
      {editing.quarantine && <div className="editor-errors">隔离原因：{editing.quarantine.reason}；隔离时间：{editing.quarantine.at}。原资料保留。恢复时请先补齐实际赛事名称、资格、专业任务和来源，再将数据状态改为草稿；恢复不等于发布。</div>}

      <fieldset><legend>基本信息</legend><div className="editor-grid">
        <label>届次 ID（只读）<input value={editing.id} readOnly /></label><label>赛事 ID（只读）<input value={editing.eventId} readOnly /></label>
        <label className="wide">赛事正文名称（不含年份和第几届）<input value={editing.name} onChange={e=>set('name',e.target.value)}/></label>
        <label>年份或赛季<input value={editing.editionYear || ''} placeholder="如 2026 或 2025—2026" onChange={e=>set('editionYear',e.target.value)}/></label>
        <label>第几届<input value={editing.editionOrdinal || ''} placeholder="如 第八届；不明确可留空" onChange={e=>set('editionOrdinal',e.target.value)}/></label>
        <label className="wide">官方届次原文（追溯用，不作为标题）<input value={editing.editionName} onChange={e=>set('editionName',e.target.value)}/></label>
        <label>赛事级别<input value={editing.eventLevel} onChange={e=>set('eventLevel',e.target.value)}/></label>
        <label className="wide">主办单位<input value={editing.organizer} onChange={e=>set('organizer',e.target.value)}/></label>
        <ListField label="别名（每行一项）" value={editing.aliases} onChange={value=>set('aliases',value)}/>
        <ListField label="客观标签（每行一项）" value={editing.objectiveTags} onChange={value=>set('objectiveTags',value)}/>
        <ListField label="适合专业（每行一项）" value={editing.professions} onChange={value=>set('professions',value)}/>
        <ListField label="数据质量问题（每行一项）" value={editing.qualityIssues} onChange={value=>set('qualityIssues',value)}/>
      </div></fieldset>

      {editing.noticeResolution && <fieldset><legend>通知追溯线索（待逐条核验）</legend>
        <p>候选赛事名称：{editing.noticeResolution.proposedName || '待提取'}。请核实主办方页面与报名入口，修改上方赛事名称和下方报名网址，并清除“通知线索待追溯”质量问题。</p>
        {(editing.noticeResolution.leads || []).map((lead:any) => <p key={lead.url}><a href={lead.url} target="_blank" rel="noreferrer">{lead.title || lead.url}</a> · {lead.status || '待核验'}</p>)}
      </fieldset>}

      <fieldset><legend>参赛与报名信息</legend><div className="editor-grid">
        <TextField label="参赛对象" value={editing.participants} onChange={value=>set('participants',value)}/>
        <TextField label="参赛资格" value={editing.eligibility} onChange={value=>set('eligibility',value)}/>
        <TextField label="赛制与规则" value={editing.formatAndRules} onChange={value=>set('formatAndRules',value)}/>
        <label>参赛形式<select value={editing.participationFormat} onChange={e=>set('participationFormat',e.target.value)}>{participationFormats.map(value=><option key={value}>{value}</option>)}</select></label>
        <label>队伍人数<select value={editing.teamSizeCategory} onChange={e=>set('teamSizeCategory',e.target.value)}>{teamSizeCategories.map(value=><option key={value}>{value}</option>)}</select></label>
        <TextField label="组队人数原文" value={editing.teamSize} onChange={value=>set('teamSize',value)}/>
        <label>报名组织方式<select value={editing.registrationOrganization} onChange={e=>set('registrationOrganization',e.target.value)}>{registrationOrganizations.map(value=><option key={value}>{value}</option>)}</select></label>
        <label>报名费用<select value={editing.feeType} onChange={e=>set('feeType',e.target.value)}>{feeTypes.map(value=><option key={value}>{value}</option>)}</select></label>
        <TextField label="官方报名方式原文" value={editing.registrationMethod} onChange={value=>set('registrationMethod',value)}/>
        <label className="wide">报名网址<input type="url" value={editing.registrationUrl} onChange={e=>set('registrationUrl',e.target.value)}/></label>
        <TextField label="费用说明原文" value={editing.fees} onChange={value=>set('fees',value)}/>
      </div></fieldset>

      <fieldset><legend>时间安排</legend><div className="editor-grid">
        <DateField label="报名开始" value={editing.schedule.registration_start} onChange={value=>setNested('schedule','registration_start',value)}/>
        <DateField label="报名截止" value={editing.schedule.registration_end} onChange={value=>setNested('schedule','registration_end',value)}/>
        <DateField label="比赛开始" value={editing.schedule.competition_start} onChange={value=>setNested('schedule','competition_start',value)}/>
        <DateField label="比赛结束" value={editing.schedule.competition_end} onChange={value=>setNested('schedule','competition_end',value)}/>
        <label>待公布<input type="checkbox" checked={Boolean(editing.schedule.pending_announcement)} onChange={e=>setNested('schedule','pending_announcement',e.target.checked)}/></label>
        <label>人工状态覆盖<input value={editing.schedule.status_override || ''} onChange={e=>setNested('schedule','status_override',e.target.value||null)}/></label>
        <TextField label="覆盖原因" value={editing.schedule.status_override_reason || ''} onChange={value=>setNested('schedule','status_override_reason',value||null)}/>
        <TextField label="时间说明" value={editing.schedule.time_note || ''} onChange={value=>setNested('schedule','time_note',value)}/>
        <label>时间变更状态<input value={editing.schedule.change_status || ''} onChange={e=>setNested('schedule','change_status',e.target.value)}/></label>
      </div></fieldset>

      <fieldset><legend>赛项信息</legend><div className="editor-grid">
        <label className="wide">赛项名称<input value={editing.track.name} onChange={e=>setNested('track','name',e.target.value)}/></label>
        <TextField label="赛项范围说明" value={editing.track.scope_note || ''} onChange={value=>setNested('track','scope_note',value)}/>
      </div></fieldset>

      <fieldset><legend>推荐内容</legend><div className="editor-grid">
        <label>推荐等级<input value={editing.recommendation.recommendation} onChange={e=>setNested('recommendation','recommendation',e.target.value)}/></label>
        <label>置信度<input value={editing.recommendation.confidence} onChange={e=>setNested('recommendation','confidence',e.target.value)}/></label>
        <TextField label="适合人群" value={editing.recommendation.suitable_for} onChange={value=>setNested('recommendation','suitable_for',value)}/>
        <ListField label="推荐理由（每行一项）" value={editing.recommendation.reasons} onChange={value=>setNested('recommendation','reasons',value)}/>
        <label className="wide">证据定位（系统自动关联）<output>{(editing.recommendation.evidence_refs || []).map(displayAuditField).join('、') || '暂无'}</output></label>
        <ListField label="限制说明（每行一项）" value={editing.recommendation.limitations} onChange={value=>setNested('recommendation','limitations',value)}/>
        <TextField label="备赛建议" value={editing.recommendation.preparation} onChange={value=>setNested('recommendation','preparation',value)}/>
        <ListField label="缺失信息（每行一项）" value={editing.recommendation.missing_information} onChange={value=>setNested('recommendation','missing_information',value)}/>
        <label>赛事数据版本<input value={editing.recommendation.event_data_version} onChange={e=>setNested('recommendation','event_data_version',e.target.value)}/></label>
        <label>推荐规则版本<input value={editing.recommendation.rule_version} onChange={e=>setNested('recommendation','rule_version',e.target.value)}/></label>
        <label>推荐系统验证（只读）<select value={editing.recommendation.system_validation} disabled>{validationStatuses.map(value=><option key={value} value={value}>{validationLabels[value]}</option>)}</select></label>
        <label>推荐人工审核（只读）<select value={editing.recommendation.manual_review} disabled>{manualStatuses.map(value=><option key={value} value={value}>{manualLabels[value]}</option>)}</select></label>
        <label>已进入公开缓存（只读）<input type="checkbox" checked={Boolean(editing.recommendation.published_cache)} disabled/></label>
      </div></fieldset>

      <fieldset><legend>审核与发布状态</legend><div className="editor-grid">
        <label>数据状态<select value={editing.dataStatus} onChange={e=>set('dataStatus',e.target.value)} disabled={editing.dataStatus==='published'}>{dataStatuses.map(value=><option key={value} value={value} disabled={value==='published'}>{dataStatusLabels[value]}</option>)}</select></label>
        <label>系统验证（只读）<select value={editing.systemValidation} disabled>{validationStatuses.map(value=><option key={value} value={value}>{validationLabels[value]}</option>)}</select></label>
        <label>人工审核（只读）<select value={editing.manualReview} disabled>{manualStatuses.map(value=><option key={value} value={value}>{manualLabels[value]}</option>)}</select></label>
        <label>最后核验日期<input type="date" value={editing.lastVerifiedAt?.slice(0,10)||''} onChange={e=>set('lastVerifiedAt',e.target.value?`${e.target.value}T00:00:00+08:00`:null)}/></label>
      </div></fieldset>

      <fieldset><legend>数据来源</legend>
        <div className="source-list">{(editing.sources || []).map((source:any,index:number)=><section className="source-card" key={source.id || index}>
          <div className="source-card-head"><b>来源 {index+1}</b><button className="danger-action" onClick={()=>removeSource(index)}>删除来源</button></div>
          <div className="editor-grid">
            <label>来源 ID（只读）<input value={source.id} readOnly/></label><label>来源类型<input value={source.source_type} onChange={e=>updateSource(index,'source_type',e.target.value)}/></label>
            <label className="wide">来源网址<input type="url" value={source.url} onChange={e=>updateSource(index,'url',e.target.value)}/></label>
            <label>是否官方<input type="checkbox" checked={Boolean(source.is_official)} onChange={e=>updateSource(index,'is_official',e.target.checked)}/></label>
            <label>有效性状态<input value={source.validity_status} onChange={e=>updateSource(index,'validity_status',e.target.value)}/></label>
            <DateField label="发布日期" value={source.published_at} onChange={value=>updateSource(index,'published_at',value)}/>
            <DateField label="最后核验时间" value={source.last_verified_at} onChange={value=>updateSource(index,'last_verified_at',value)}/>
          </div>
        </section>)}</div>
        <button className="add-source" onClick={addSource}>＋ 添加数据来源</button>
      </fieldset>

      <div className="editor-actions sticky-actions">{!isNew && <button className="danger-action" onClick={onDelete}>彻底移除这条赛事</button>}<button disabled={saving} onClick={onCancel}>取消</button><button disabled={saving} className="primary" onClick={onSave}>{saving ? '正在入库…' : isNew ? '保存到比赛库（草稿）' : '保存修改'}</button></div>
    </section>
  </div>;
}

function TextField({ label, value, onChange }: { label:string; value:string; onChange:(value:string)=>void }) {
  return <label className="wide">{label}<textarea value={value || ''} onChange={e=>onChange(e.target.value)}/></label>;
}

function ListField({ label, value, onChange }: { label:string; value:unknown; onChange:(value:string[])=>void }) {
  return <label className="wide">{label}<textarea value={listToLines(value)} onChange={e=>onChange(linesToList(e.target.value))}/></label>;
}

function DateField({ label, value, onChange }: { label:string; value:unknown; onChange:(value:string|null)=>void }) {
  return <label>{label}<input type="datetime-local" value={toDateTimeLocal(value)} onChange={e=>onChange(fromDateTimeLocal(e.target.value))}/></label>;
}
