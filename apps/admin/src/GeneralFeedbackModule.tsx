import { useEffect, useRef, useState } from 'react';
import { describeCloudError, listGeneralFeedback, updateGeneralFeedback, type GeneralFeedbackRecord } from './adminCloud';
import './generalFeedback.css';

const statuses = { pending:'待处理', processing:'处理中', resolved:'已解决' };
const types = { bug:'功能异常', suggestion:'使用建议', data:'数据问题', other:'其他' };
const formatTime = (value:string) => value ? new Date(value).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai'}) : '—';
const pageSize = 20;

export default function GeneralFeedbackModule() {
  const [items, setItems] = useState<GeneralFeedbackRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<GeneralFeedbackRecord|null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const requestId = useRef(0);

  async function refresh() {
    const current = ++requestId.current;
    setLoading(true); setError('');
    try {
      const result = await listGeneralFeedback({status, type, page, pageSize});
      if (current !== requestId.current) return;
      setItems(result.items); setTotal(result.total);
    } catch (caught) { if (current === requestId.current) setError(describeCloudError(caught)); }
    finally { if (current === requestId.current) setLoading(false); }
  }
  useEffect(() => { void refresh(); return () => { ++requestId.current; }; }, [status,type,page]);

  async function save() {
    if (!editing || saving) return;
    if (editing.status === 'resolved' && !editing.publicReply.trim()) {
      setSaveError('标记为已解决时，请填写具体的公开回复。'); return;
    }
    setSaving(true); setSaveError(''); setNotice('');
    try {
      await updateGeneralFeedback({id:editing.id,status:editing.status,publicReply:editing.publicReply.trim(),internalNote:editing.internalNote.trim(),expectedUpdatedAt:editing.updatedAt});
      setEditing(null); setNotice('处理结果已保存，用户可在“我的反馈”查看状态和公开回复。');
      await refresh();
    } catch (caught) {
      const message = describeCloudError(caught);
      setSaveError(message.includes('feedback_conflict') ? '这条反馈已被其他管理员修改，请保留当前内容，关闭后刷新并重新处理。' : message);
    }
    finally { setSaving(false); }
  }

  return <div className="general-feedback">
    <header><div><h1>意见反馈</h1><p>处理小程序使用建议和功能问题，保存后的状态与公开回复同步展示给提交用户。</p></div><button disabled={loading || saving} onClick={() => void refresh()}>刷新</button></header>
    {notice && <p role="status" className="save-notice">{notice}</p>}
    {error && <p role="alert" className="general-feedback-error">读取失败：{error}</p>}
    <section className="panel">
      <div className="toolbar"><select aria-label="反馈类型" value={type} onChange={event => {setType(event.target.value);setPage(1);}}><option value="">全部类型</option>{Object.entries(types).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="处理状态" value={status} onChange={event => {setStatus(event.target.value);setPage(1);}}><option value="">全部状态</option>{Object.entries(statuses).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select><span>{loading ? '正在读取…' : `共 ${total} 条`}</span></div>
      {!loading && !error && items.length === 0 && <p className="general-feedback-empty">暂无符合条件的意见反馈。</p>}
      {items.length > 0 && <div className="table-wrap"><table><thead><tr><th>类型 / 提交时间</th><th>反馈内容</th><th>联系方式</th><th>处理状态 / 公开回复</th><th>操作</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td>{types[item.type] || item.type}<small>{formatTime(item.createdAt)}</small></td><td className="general-feedback-content">{item.content}</td><td>{item.contact || '未填写'}</td><td className="general-feedback-content"><span className={`general-feedback-status status-${item.status}`}>{statuses[item.status] || item.status}</span><p>{item.publicReply || '尚未回复'}</p><small>更新：{formatTime(item.updatedAt)}</small></td><td><button disabled={loading} onClick={() => {setEditing({...item,publicReply:item.publicReply || '',internalNote:item.internalNote || ''});setSaveError('');}}>处理</button></td></tr>)}</tbody></table></div>}
      <footer className="panel-footer"><span>第 {page} 页 · 按提交时间从新到旧排列</span><div><button disabled={loading || page<=1} onClick={() => setPage(value=>value-1)}>上一页</button><button disabled={loading || page*pageSize>=total} onClick={() => setPage(value=>value+1)}>下一页</button></div></footer>
    </section>
    {editing && <div className="modal-mask"><section role="dialog" aria-modal="true" aria-labelledby="general-feedback-title" className="editor-modal general-feedback-dialog"><div className="editor-head"><div><h2 id="general-feedback-title">处理意见反馈</h2><p>{types[editing.type]} · {formatTime(editing.createdAt)}</p></div><button disabled={saving} className="modal-close" aria-label="关闭" onClick={() => setEditing(null)}>×</button></div><p className="general-feedback-original">{editing.content}</p><p>联系方式：{editing.contact || '未填写'}</p><label>处理状态<select disabled={saving} value={editing.status} onChange={event=>setEditing({...editing,status:event.target.value as GeneralFeedbackRecord['status']})}>{Object.entries(statuses).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>公开回复（用户可见）<textarea disabled={saving} maxLength={2000} value={editing.publicReply} onChange={event=>setEditing({...editing,publicReply:event.target.value})} placeholder="说明已完成的处理或具体进展；已解决时必须填写。"/></label><label>内部备注（仅后台可见）<textarea disabled={saving} maxLength={2000} value={editing.internalNote} onChange={event=>setEditing({...editing,internalNote:event.target.value})}/></label>{saveError && <p role="alert" className="general-feedback-error">{saveError}</p>}<div className="editor-actions"><button disabled={saving} onClick={()=>setEditing(null)}>取消</button><button disabled={saving} className="primary" onClick={()=>void save()}>{saving?'正在保存…':'保存处理结果'}</button></div></section></div>}
  </div>;
}
