import { useMemo, useRef, useState } from 'react';
import { saveAdminRecordsWithAudit, type AuditEntry } from './dataStore';
import { describeCloudError } from './adminCloud';
import { buildProfessionCatalog, normalizeProfessions } from './adminWorkflow';

interface Props {
  records: any[];
  setRecords: (records: any[]) => void;
  setAudits: (audits: AuditEntry[]) => void;
  setNotice: (notice: string) => void;
}

export default function ProfessionMappingModule({ records, setRecords, setAudits, setNotice }: Props) {
  const catalog = useMemo(() => buildProfessionCatalog(records), [records]);
  const [keyword, setKeyword] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [saving,setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError,setSaveError] = useState('');

  const rows = useMemo(() => records.filter(record => {
    if (onlyMissing && record.professions?.length) return false;
    return !keyword || `${record.name} ${record.editionName} ${(record.professions || []).join(' ')}`.toLowerCase().includes(keyword.toLowerCase());
  }), [records, keyword, onlyMissing]);

  function open(record: any) {
    setEditing(record);
    setSelected([...(record.professions || [])]);
    setCustom('');
    setSaveError('');
  }

  async function save() {
    if (!editing || savingRef.current) return;
    const professions = normalizeProfessions([...selected, custom]);
    if (!professions.length) {
      setNotice('至少选择或填写一个适合专业；资料不明确时请选择“综合/不限专业”或返回赛事编辑补充依据');
      return;
    }
    if (!window.confirm(`确定将“${editing.name}”的适合专业更新为：
${professions.join('、')}？

该映射必须来自已核验资料，不应由 AI 推断。`)) return;
    const now = new Date().toISOString();
    const updated = { ...editing, professions, professionMappedAt: now, professionMappedBy: 'admin@example.local', updatedAt: now, updatedBy: 'admin@example.local' };
    const next = records.map(record => record.id === updated.id ? updated : record);
    savingRef.current=true;setSaving(true);setSaveError('');
    try {
      const nextAudits = await saveAdminRecordsWithAudit(next, { action: 'profession_mapping_update', recordId: updated.id, recordName: updated.name, changedFields: ['professions'], actor: 'admin@example.local', changes: { professions: { before: editing.professions || [], after: professions } } });
      setRecords(next); setAudits(nextAudits);
      setEditing(null); setNotice(`${updated.name} 的专业映射已保存`);
    } catch(error) { const message=`保存失败：${describeCloudError(error)}`;setNotice(message);setSaveError(message); }
    finally {savingRef.current=false;setSaving(false);}
  }

  return <>
    <header><div><h1>专业映射</h1><p>维护小程序“适合专业”筛选标签；只录入有资料依据的映射，不使用 AI 猜测。</p></div></header>
    <section className="metrics"><article><span>赛事总数</span><strong>{records.length}</strong></article><article><span>已映射</span><strong>{records.filter(x => x.professions?.length).length}</strong></article><article><span>待映射</span><strong>{records.filter(x => !x.professions?.length).length}</strong></article><article><span>专业标签</span><strong>{catalog.length}</strong></article></section>
    <section className="panel"><div className="toolbar admin-toolbar"><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索赛事或专业标签"/><label className="inline-check"><input type="checkbox" checked={onlyMissing} onChange={event => setOnlyMissing(event.target.checked)}/>只看待映射</label></div>
      <div className="table-wrap"><table><thead><tr><th>赛事与届次</th><th>当前专业映射</th><th>映射状态</th><th>最后维护</th><th>操作</th></tr></thead><tbody>{rows.map(record => <tr key={record.id}><td><b>{record.name}</b><small>{record.editionName}</small></td><td><div className="profession-chips">{record.professions?.length ? record.professions.map((value: string) => <span key={value}>{value}</span>) : <em>尚未映射</em>}</div></td><td>{record.professions?.length ? '已映射' : '待人工确认'}</td><td>{record.professionMappedAt?.slice(0, 10) || '来自初始底稿'}</td><td><button disabled={saving} className="link" onClick={() => open(record)}>编辑映射</button></td></tr>)}</tbody></table></div>
    </section>
    {editing && <div className="editor-backdrop"><section className="editor-card mapping-editor"><fieldset disabled={saving} style={{border:0,padding:0,margin:0}}><header><div><h2>编辑专业映射</h2><p>{editing.name}</p></div><button className="editor-close" onClick={() => setEditing(null)}>×</button></header><div className="mapping-warning">请根据官方资料或人工核验结论选择，资料未明确时不要推断专业。</div><div className="mapping-options">{catalog.map(value => <label key={value}><input type="checkbox" checked={selected.includes(value)} onChange={event => setSelected(current => event.target.checked ? [...current, value] : current.filter(item => item !== value))}/><span>{value}</span></label>)}</div><label className="custom-profession">新增专业标签<input value={custom} onChange={event => setCustom(event.target.value)} placeholder="如：建筑与设计（有资料依据时添加）"/></label>{saveError && <p role="alert" className="editor-errors">{saveError}</p>}<footer><button onClick={() => setEditing(null)}>取消</button><button className="primary-button" onClick={save}>保存映射</button></footer></fieldset></section></div>}
  </>;
}
