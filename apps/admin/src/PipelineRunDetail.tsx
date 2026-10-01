import { useEffect, useMemo, useState } from 'react';
import { describeCloudError, getPipelineRunDetail, type PipelineRunDetail as Detail, type PipelineRunRow } from './adminCloud';
import PipelineFlow, { kindName, plain } from './PipelineFlow';

// 单轮抓取明细：上面是数据流图，下面是逐条明细表，两者合在一块：
// 点流程图的方框、连线或连线上的数字，明细表就只显示对应的那批比赛，并多一列“在这个环节的结果”。
// 点标题在新标签页打开原网页。
const STAGE_CLASS = ['stage-dropped', 'stage-dup', 'stage-filtered', 'stage-traced', 'stage-read'];
const FILTER_LABEL: Record<string, string> = { fetch:'放行读正文', review:'低置信度只留线索', lead:'只留线索', trace:'追溯上级赛事', reject:'丢弃' };
const shortUrl = (url:string) => url.length > 80 ? `${url.slice(0, 80)}…` : url;
const finalGroup = (text:string) => text.replace(/（.*|：.*/, '');

// 选中的是一个环节（可再按处理结果细分），或者一条连线；都没选就显示全部
type Selection = { kind:'node'; id:string; outcome:string } | { kind:'edge'; id:string } | null;

const entryOf = (row:PipelineRunRow, nodeId:string) => (row.trail || []).find(entry => entry.n === nodeId && !entry.virtual);
const onEdge = (row:PipelineRunRow, from:string, to:string) => (row.trail || []).some((entry, index) => entry.n === from && row.trail![index + 1]?.n === to);

export default function PipelineRunDetail({ runId, onBack }:{ runId:string; onBack:()=>void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    getPipelineRunDetail(runId).then(setDetail).catch(caught => setError(describeCloudError(caught)));
  }, [runId]);
  if (error) return <div className="pipeline-detail-page"><button onClick={onBack}>‹ 返回结果账</button><p role="alert" className="pipeline-error">读取失败：{error === 'run_not_found' ? '服务器上找不到这一轮的运行记录（可能是很早的运行，当时还没有逐条留档）' : error}</p></div>;
  if (!detail) return <div className="pipeline-detail-page"><button onClick={onBack}>‹ 返回结果账</button><p>正在读取明细…</p></div>;
  return <PipelineRunView detail={detail} onBack={onBack}/>;
}

export function PipelineRunView({ detail, onBack }:{ detail:Detail; onBack:()=>void }) {
  const [keyword, setKeyword] = useState('');
  const [stage, setStage] = useState('');
  const [kind, setKind] = useState('');
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<Selection>(null);

  const flow = detail.flow;
  const nodeById = useMemo(() => new Map((flow?.nodes || []).map(node => [node.id, node])), [flow]);
  const selectedNode = selection?.kind === 'node' ? nodeById.get(selection.id) : undefined;
  const selectedEdge = selection?.kind === 'edge' ? selection.id.split('>') : null;

  const options = useMemo(() => {
    const uniq = (values:string[]) => [...new Set(values.filter(Boolean))].sort();
    return { stages:uniq(detail.rows.map(row => finalGroup(row.final))), kinds:uniq(detail.rows.map(row => row.kind)), queries:uniq(detail.rows.map(row => row.query)) };
  }, [detail]);

  // 流程图选中的那批比赛（再叠加下面的搜索和下拉筛选）
  const selectedRows = useMemo(() => detail.rows.filter(row => {
    if (!selection) return true;
    if (selection.kind === 'edge') { const [from, to] = selection.id.split('>'); return onEdge(row, from, to); }
    const entry = entryOf(row, selection.id);
    return Boolean(entry) && (!selection.outcome || entry!.o === selection.outcome);
  }), [detail, selection]);
  const rows = useMemo(() => selectedRows.filter(row =>
    (!keyword || `${row.title} ${row.url} ${row.reason} ${row.intro}`.toLowerCase().includes(keyword.toLowerCase()))
    && (!stage || finalGroup(row.final) === stage) && (!kind || row.kind === kind) && (!query || row.query === query)), [selectedRows, keyword, stage, kind, query]);

  // “在这个环节的结果”那一列：选中环节时是该环节对这条的处理结果和说明；选中连线时是出发环节的说明
  const contextOf = (row:PipelineRunRow) => {
    if (selection?.kind === 'node' && selectedNode) {
      const entry = entryOf(row, selection.id);
      if (selectedNode.kind === 'end') return { head:'', note:row.final };
      const outcome = selectedNode.outcomes.find(item => item.id === entry?.o);
      return { head:outcome?.label || '', note:entry?.note || '' };
    }
    if (selectedEdge) {
      const from = nodeById.get(selectedEdge[0]);
      const entry = entryOf(row, selectedEdge[0]);
      const outcome = from?.outcomes.find(item => item.id === entry?.o);
      return { head:outcome?.label || '', note:entry?.note || '' };
    }
    return { head:'', note:'' };
  };
  const choose = (next:Selection) => { setSelection(next); };

  const s = detail.summary;
  const contextHead = selectedNode ? `在「${plain(selectedNode.label)}」的结果` : selectedEdge ? `走「${plain(nodeById.get(selectedEdge[0])?.label || '')} → ${plain(nodeById.get(selectedEdge[1])?.label || '')}」的原因` : '';
  return <div className="pipeline-detail-page">
    <header><div><button onClick={onBack}>‹ 返回结果账</button><h1>本轮明细 · {new Date(runIdToIso(detail.id)).toLocaleString('zh-CN', { timeZone:'Asia/Shanghai', hour12:false })}</h1>
      <p>上面是这一轮的数据流图，下面是每一条候选的去向。点流程图的方框、连线或连线上的数字，明细表就只显示对应的比赛。</p></div></header>
    <p className="pipeline-note">搜索时丢弃 {s.dropped} 条；前置筛选：{Object.entries(s.filter).map(([key, value]) => `${FILTER_LABEL[key] || key} ${value}`).join('、')}；
      其中 {s.formalNotices} 条正式通知转去追溯赛事官网。{Object.keys(s.failureReasons).length ? `读了详情页但未入库的原因：${Object.entries(s.failureReasons).map(([key, value]) => `${key}（${value}）`).join('；')}。` : ''}</p>

    {detail.sourceSchedule && detail.sourceSchedule.some(item => item.everyDays > 0) && <p className="pipeline-note">固定来源每 {detail.sourceSchedule.find(item => item.everyDays > 0)?.everyDays} 天才抓一次：{detail.sourceSchedule.filter(item => item.everyDays > 0).map(item =>
      `${item.source}${item.ran ? '本轮已抓取' : `本轮没抓（上次 ${item.lastCrawledAt ? new Date(item.lastCrawledAt).toLocaleDateString('zh-CN', { timeZone:'Asia/Shanghai' }) : '—'}，下次约 ${item.nextDueAt ? new Date(item.nextDueAt).toLocaleDateString('zh-CN', { timeZone:'Asia/Shanghai' }) : '—'}）`}`).join('；')}。百度搜索每晚都跑。</p>}

    <section className="panel pipeline-flow">
      {flow ? <>
        <div className="flow-legend"><span className="flow-dot system">系统</span>固定规则，每次结果一样，不花钱　<span className="flow-dot ai">AI</span>用了模型判断　<span className="flow-dot end">结束</span>不再往下走　· 方框右上角是流入场数，连线上的数字是走这条线的场数</div>
        <PipelineFlow nodes={flow.nodes} edges={flow.edges} selectedNode={selection?.kind === 'node' ? selection.id : ''} selectedEdge={selection?.kind === 'edge' ? selection.id : ''}
          onNode={id => choose(selection?.kind === 'node' && selection.id === id ? null : { kind:'node', id, outcome:'' })}
          onEdge={id => choose(selection?.kind === 'edge' && selection.id === id ? null : { kind:'edge', id })}
          onClear={() => choose(null)}/>
      </> : <p className="pipeline-count">这一轮没有数据流图（运行记录太早，缺少逐条路径）。</p>}

      {flow && (selection
        ? <div className="flow-selection">
          <div className="flow-selection-head">
            {selectedNode && <><span className={`flow-dot ${selectedNode.kind}`}>{kindName(selectedNode.kind)}</span><b>{plain(selectedNode.label)}</b><span>流入 {selectedNode.in} 场</span></>}
            {selectedEdge && <><b>{plain(nodeById.get(selectedEdge[0])?.label || selectedEdge[0])} → {plain(nodeById.get(selectedEdge[1])?.label || selectedEdge[1])}</b><span>共 {selectedRows.length} 场</span></>}
            <button type="button" className="flow-clear" onClick={() => choose(null)}>清除选择，看全部</button>
          </div>
          {selectedNode?.who && <p className="flow-who">{selectedNode.who}</p>}
          {selectedNode?.desc && <p className="flow-desc">{selectedNode.desc}</p>}
          {selectedNode && selectedNode.kind !== 'end' && <div className="flow-chips">
            <button type="button" className={`flow-chip${selection.kind === 'node' && !selection.outcome ? ' on' : ''}`} onClick={() => choose({ kind:'node', id:selectedNode.id, outcome:'' })}>全部<b>{selectedNode.in}</b></button>
            {selectedNode.outcomes.filter(outcome => outcome.count > 0).map(outcome => <button type="button" key={outcome.id} className={`flow-chip${selection.kind === 'node' && selection.outcome === outcome.id ? ' on' : ''}`}
              onClick={() => choose({ kind:'node', id:selectedNode.id, outcome:selection.kind === 'node' && selection.outcome === outcome.id ? '' : outcome.id })}>{outcome.label}<b>{outcome.count}</b>{nodeById.get(outcome.to) && <small>→ {plain(nodeById.get(outcome.to)!.label)}</small>}</button>)}
          </div>}
        </div>
        : <div className="flow-selection idle">点上面流程图的任意方框、连线或连线上的数字，下面的明细表会只显示对应的比赛，以及它们在这个环节的处理结果。现在显示的是全部明细。</div>)}

      <div className="pipeline-filters">
        <input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜标题、网址或理由"/>
        <select value={stage} onChange={event => setStage(event.target.value)}><option value="">全部去向</option>{options.stages.map(value => <option key={value}>{value}</option>)}</select>
        <select value={kind} onChange={event => setKind(event.target.value)}><option value="">全部分类</option>{options.kinds.map(value => <option key={value}>{value}</option>)}</select>
        <select value={query} onChange={event => setQuery(event.target.value)}><option value="">全部查询</option>{options.queries.map(value => <option key={value}>{value}</option>)}</select>
      </div>
      <p className="pipeline-count">显示 {rows.length} / {detail.rows.length} 条</p>
      <div className="table-wrap"><table className="pipeline-rows">
        <thead><tr><th>编号</th><th>标题 / 网址</th>{contextHead && <th>{contextHead}</th>}<th>来源</th><th>判重</th><th>前置筛选</th><th>分类与理由</th><th>最终去向</th><th>来自哪条查询</th></tr></thead>
        <tbody>{rows.map((row, index) => {
          const context = contextHead ? contextOf(row) : null;
          return <tr key={`${row.url}-${index}`}>
            <td className={`row-no level-${(row.no || '').split('.').length}`}>{row.no || '—'}</td>
            <td className="title-cell">{row.url ? <a href={row.url} target="_blank" rel="noreferrer"><b>{row.title || '（无标题）'}</b><small>{shortUrl(row.url)}</small></a> : <b>{row.title}</b>}{row.intro && <small className="intro">{row.intro}</small>}</td>
            {context && <td className="flow-context">{context.head && <b>{context.head}</b>}{context.note && <small>{context.note}</small>}</td>}
            <td className="muted">{row.source}</td>
            <td>{row.dup === '新' ? <span className="chip">新</span> : <small className="muted">{row.dup}</small>}</td>
            <td>{row.filter}{row.confidence != null && <small className="muted">把握 {Math.round(row.confidence * 100)}%</small>}</td>
            <td>{row.kind && <span className="chip">{row.kind}</span>}<small className="muted">{row.reason}</small></td>
            <td className={STAGE_CLASS[row.stage]}>{row.final}{row.thinking && <details className="ai-thinking"><summary>AI 思考过程（{row.thinking.length} 字）</summary><pre>{row.thinking}</pre></details>}</td>
            <td className="muted">{row.query}</td>
          </tr>;
        })}</tbody>
      </table></div>
    </section>

    {detail.notices.length > 0 && <section className="panel"><h2>转入通知追溯的正式通知</h2>
      {detail.searchEngines && detail.searchEngines.length > 0 && <p className="pipeline-note">本轮搜索引擎（百度用完换 Kimi，再不够用 DeepSeek）：{detail.searchEngines.map(item =>
        `${item.label} 用了 ${item.used} 次、剩 ${item.left} 次${item.configured ? '' : '（没配密钥）'}${item.disabled ? '（连续失败，已停用）' : ''}`).join('；')}。</p>}
      <div className="table-wrap"><table><thead><tr><th>编号</th><th>通知</th><th>推出的赛事名</th><th>追溯查询</th><th>用了哪种办法，返回了什么</th><th>找到的待核验页面</th></tr></thead>
        <tbody>{detail.notices.map(notice => <tr key={notice.url}><td className="row-no">{notice.no || '—'}</td><td><a href={notice.url} target="_blank" rel="noreferrer">{notice.title}</a></td><td>{notice.name}</td><td className="muted">{notice.query}</td>
          <td className="search-cell">{notice.pageVisit && notice.pageVisit.visits.length > 0 && <p className="muted">①访问通知页面：{notice.pageVisit.visits.map(visit =>
            visit.status === 'ok' ? `读到，提取到 ${visit.found} 个网址` : visit.status === 'unreadable_host' ? '网站读不了（微信等）' : `没读到（${visit.status}）`).join('；')}</p>}
            {notice.searchSkipped && <p className="muted">②{notice.searchSkipped}</p>}
            {notice.search
            ? <details><summary><span className={`chip engine-${notice.search.engine}`}>{notice.search.label}</span> 返回 {notice.search.returned} 条，保留 {notice.search.kept} 条</summary>
              {notice.search.attempts.some(attempt => !attempt.ok) && <p className="muted">{notice.search.attempts.map(attempt => `${attempt.label}${attempt.ok ? ` 成功（${attempt.returned} 条）` : ` 失败（${attempt.error}）`}`).join(' → ')}</p>}
              {notice.search.attempts.some(attempt => attempt.usage) && <p className="muted">{notice.search.attempts.filter(attempt => attempt.usage).map(attempt => `${attempt.label}：输入 ${attempt.usage?.inputTokens} token，输出 ${attempt.usage?.outputTokens} token`).join('；')}</p>}
              <ol>{notice.search.results.map(result => <li key={result.url} className={result.kept ? 'kept' : 'dropped'}><a href={result.url} target="_blank" rel="noreferrer">{result.title || result.url}</a><small>{result.kept ? `保留${result.no ? `，编号 ${result.no}` : ''}` : '筛掉'}</small></li>)}</ol></details>
            : notice.error ? <small className="muted">搜索失败：{notice.error}</small>
              : notice.query ? <small className="muted">已搜索，没有返回记录</small> : notice.searchSkipped ? null : <small className="muted">{notice.leads.length ? '没搜（通知正文里写出了网址）' : '没搜（额度用完或名字不成立）'}</small>}</td>
          <td>{notice.leads.length ? notice.leads.map(lead => <div key={lead.url}>{lead.no && <b className="row-no">{lead.no}</b>} <a href={lead.url} target="_blank" rel="noreferrer">{lead.title || lead.url}</a></div>) : <small className="muted">没有找到</small>}</td></tr>)}</tbody></table></div></section>}

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
