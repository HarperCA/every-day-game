interface Props {
  record: any;
  onClose: () => void;
  onEdit: () => void;
}

const sourceTypeLabels: Record<string, string> = {
  organizer_website: '赛事官网',
  official_registration_system: '比赛或报名入口',
  organizer_notice: '主办方通知',
  authority_notice: '主管部门通知',
  university_notice: '高校通知',
  media_report: '媒体报道',
  competition_directory: '赛事目录',
  discovery_notice: '发现线索',
  search_candidate: '搜索线索',
};
const validityLabels: Record<string, string> = { valid:'已核验有效', unchecked:'待核验', invalid:'原文不支持', unreachable:'链接无法打开' };

export default function SourceReviewDialog({ record, onClose, onEdit }: Props) {
  return <div className="modal-mask" onMouseDown={onClose}>
    <section className="editor-modal source-review-modal" role="dialog" aria-modal="true" aria-label={`${record.name}来源依据`} onMouseDown={event=>event.stopPropagation()}>
      <div className="editor-head"><div><h2>来源依据</h2><p>{record.name} · {record.editionName}</p></div><button className="modal-close" onClick={onClose} aria-label="关闭">×</button></div>
      <p className="source-review-intro">逐条核对原文内容及其支持的字段。摘要和摘录仅供定位，状态为“待核验”的来源仍需打开原文确认。</p>
      <div className="source-list">{(record.sources || []).map((source: any, index: number) => <section className="source-card" key={source.id || index}>
        <div className="source-card-head"><b>{index+1}. {source.title || sourceTypeLabels[source.source_type] || '来源标题未记录'}</b><span className="source-review-status">{source.is_official ? '标记为官方' : '非官方'} · {validityLabels[source.validity_status] || '状态未记录'}</span></div>
        <dl className="source-review-details">
          <dt>来源类型</dt><dd>{sourceTypeLabels[source.source_type] || source.source_type || '未记录'}</dd>
          <dt>内容摘要</dt><dd>{source.content_summary || '未记录；不能只凭网址完成审查'}</dd>
          <dt>原文摘录</dt><dd>{source.evidence_excerpt || '未记录；请打开原文补充'}</dd>
          <dt>支持核对</dt><dd>{Array.isArray(source.supports_fields) ? source.supports_fields.join('、') || '未记录' : '未记录'}</dd>
          <dt>采用或存疑原因</dt><dd>{source.review_reason || '未记录；请说明这条来源能证明什么、不能证明什么'}</dd>
          <dt>核验时间</dt><dd>{source.last_verified_at ? new Date(source.last_verified_at).toLocaleString('zh-CN') : '未记录'}</dd>
        </dl>
        {source.url && <a className="source-review-link" href={source.url} target="_blank" rel="noreferrer">打开来源原文 ↗</a>}
      </section>)}</div>
      {!(record.sources || []).length && <p className="source-review-empty">尚未登记来源</p>}
      <div className="editor-actions"><button onClick={onClose}>关闭</button><button className="primary" onClick={onEdit}>编辑来源资料</button></div>
    </section>
  </div>;
}
