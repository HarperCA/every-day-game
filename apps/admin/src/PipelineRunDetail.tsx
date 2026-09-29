import { useEffect, useMemo, useState } from 'react';
import { describeCloudError, getPipelineRunDetail, type PipelineRunDetail as Detail } from './adminCloud';

// 单轮抓取明细：每一条候选从哪来、前置筛选怎么判、最后去了哪。点标题在新标签页打开原网页。
const STAGE_CLASS = ['stage-dropped', 'stage-dup', 'stage-filtered', 'stage-traced', 'stage-read'];
const FILTER_LABEL: Record<string, string> = { fetch:'放行读正文', review:'低置信度只留线索', lead:'只留线索', reject:'拦截' };
const shortUrl = (url:string) => url.length > 80 ? `${url.slice(0, 80)}…` : url;
const finalGroup = (text:string) => text.replace(/（.*|：.*/, '');

export default function PipelineRunDetail({ runId, onBack }:{ runId:string; onBack:()=>void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [stage, setStage] = useState('');
  const [kind, setKind] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    getPipelineRunDetail(runId).then(setDetail).catch(caught => setError(describeCloudError(caught)));
  }, [runId]);

  const options = useMemo(() => {
    const rows = detail?.rows || [];
    const uniq = (values:string[]) => [...new Set(values.filter(Boolean))].sort();
    return { stages:uniq(rows.map(row => finalGroup(row.final))), kinds:uniq(rows.map(row => row.kind)), queries:uniq(rows.map(row => row.query)) };
  }, [detail]);
  const rows = useMemo(() => (detail?.rows || []).filter(row =>
    (!keyword || `${row.title} ${row.url} ${row.reason} ${row.intro}`.toLowerCase().includes(keyword.toLowerCase()))
    && (!stage || finalGroup(row.final) === stage) && (!kind || row.kind === kind) && (!query || row.query === query)), [detail, keyword, stage, kind, query]);

  if (error) return <div className="pipeline-detail-page"><button onClick={onBack}>‹ 返回结果账</button><p role="alert" className="pipeline-error">读取失败：{error === 'run_not_found' ? '服务器上找不到这一轮的运行记录（可能是很早的运行，当时还没有逐条留档）' : error}</p></div>;
  if (!detail) return <div className="pipeline-detail-page"><button onClick={onBack}>‹ 返回结果账</button><p>正在读取明细…</p></div>;
  const s = detail.summary;
  const funnel:Array<[number | null, string]> = [[s.searchResults, `搜索结果（${s.queries} 条查询）`], [s.candidates, '成为候选'], [s.newCandidates, '判重后是新的'],
    [s.filter.fetch || 0, '前置筛选放行'], [s.detailRead, '读了详情页'], [s.extractOk, '抽取成功'], [s.added, '入库']];
  return <div className="pipeline-detail-page">
    <header><div><button onClick={onBack}>‹ 返回结果账</button><h1>本轮明细 · {new Date(runIdToIso(detail.id)).toLocaleString('zh-CN', { timeZone:'Asia/Shanghai', hour12:false })}</h1>
      <p>每一条候选的去向。点标题在新标签页打开原网页。</p></div></header>
    <div className="pipeline-funnel">{funnel.map(([value, label], index) => <div key={label}>{index > 0 && <span className="arrow">→</span>}<div className="step"><b>{value ?? '—'}</b><span>{label}</span></div></div>)}</div>
    <p className="pipeline-note">搜索时丢弃 {s.dropped} 条；前置筛选：{Object.entries(s.filter).map(([key, value]) => `${FILTER_LABEL[key] || key} ${value}`).join('、')}；
      其中 {s.formalNotices} 条正式通知转去追溯赛事官网。{Object.keys(s.failureReasons).length ? `读了详情页但未入库的原因：${Object.entries(s.failureReasons).map(([key, value]) => `${key}（${value}）`).join('；')}。` : ''}</p>

    <section className="panel">
      <div className="pipeline-filters">
        <input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜标题、网址或理由"/>
        <select value={stage} onChange={event => setStage(event.target.value)}><option value="">全部去向</option>{options.stages.map(value => <option key={value}>{value}</option>)}</select>
        <select value={kind} onChange={event => setKind(event.target.value)}><option value="">全部分类</option>{options.kinds.map(value => <option key={value}>{value}</option>)}</select>
        <select value={query} onChange={event => setQuery(event.target.value)}><option value="">全部查询</option>{options.queries.map(value => <option key={value}>{value}</option>)}</select>
      </div>
      <p className="pipeline-count">显示 {rows.length} / {detail.rows.length} 条</p>
      <div className="table-wrap"><table className="pipeline-rows">
        <thead><tr><th>#</th><th>标题 / 网址</th><th>来源</th><th>判重</th><th>前置筛选</th><th>分类与理由</th><th>最终去向</th><th>来自哪条查询</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={`${row.url}-${index}`}>
          <td className="muted">{index + 1}</td>
          <td className="title-cell">{row.url ? <a href={row.url} target="_blank" rel="noreferrer"><b>{row.title || '（无标题）'}</b><small>{shortUrl(row.url)}</small></a> : <b>{row.title}</b>}{row.intro && <small className="intro">{row.intro}</small>}</td>
          <td className="muted">{row.source}</td>
          <td>{row.dup === '新' ? <span className="chip">新</span> : <small className="muted">{row.dup}</small>}</td>
          <td>{row.filter}{row.confidence != null && <small className="muted">把握 {Math.round(row.confidence * 100)}%</small>}</td>
          <td>{row.kind && <span className="chip">{row.kind}</span>}<small className="muted">{row.reason}</small></td>
          <td className={STAGE_CLASS[row.stage]}>{row.final}</td>
          <td className="muted">{row.query}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    {detail.notices.length > 0 && <section className="panel"><h2>转入通知追溯的正式通知</h2>
      <div className="table-wrap"><table><thead><tr><th>通知</th><th>推出的赛事名</th><th>追溯查询</th><th>找到的待核验页面</th></tr></thead>
        <tbody>{detail.notices.map(notice => <tr key={notice.url}><td><a href={notice.url} target="_blank" rel="noreferrer">{notice.title}</a></td><td>{notice.name}</td><td className="muted">{notice.query}</td>
          <td>{notice.leads.length ? notice.leads.map(lead => <div key={lead.url}><a href={lead.url} target="_blank" rel="noreferrer">{lead.title || lead.url}</a></div>) : <small className="muted">没有找到</small>}</td></tr>)}</tbody></table></div></section>}

    {detail.perQuery.length > 0 && <section className="panel"><h2>每条查询的结果去向</h2>
      <div className="table-wrap"><table><thead><tr><th>查询</th><th>路线</th><th>返回</th><th>不在收录范围</th><th>与竞赛不相关</th><th>同轮重复</th><th>成为候选</th></tr></thead>
        <tbody>{detail.perQuery.map(item => <tr key={item.query}><td>{item.query}</td><td className="muted">{item.route}</td><td>{item.results}</td><td>{item.outOfScope}</td><td>{item.irrelevant}</td><td>{item.duplicate}</td><td><b>{item.candidates}</b></td></tr>)}</tbody></table></div></section>}
  </div>;
}

// 运行编号形如 2026-09-28T17-00-00-614Z，还原成时间
function runIdToIso(id:string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(id);
  return match ? `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z` : id;
}
