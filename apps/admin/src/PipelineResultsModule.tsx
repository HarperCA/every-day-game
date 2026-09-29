import { useEffect, useState } from 'react';
import { describeCloudError, listPipelineRuns, type PipelineRun } from './adminCloud';
import './pipelineResults.css';
import PipelineRunDetail from './PipelineRunDetail';

const count = (value:number | null | undefined) => value == null ? '未记录' : String(value);
const time = (value:string | null) => value ? new Date(value).toLocaleString('zh-CN', { timeZone:'Asia/Shanghai' }) : '未记录';
const dollars = (value:number | null) => value == null ? '未记录' : `$${value.toFixed(6)}`;

export default function PipelineResultsModule() {
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [openRun, setOpenRun] = useState('');
  async function refresh() {
    setPending(true); setError('');
    try { setRuns((await listPipelineRuns()).runs || []); }
    catch (caught) { setError(describeCloudError(caught)); }
    finally { setPending(false); }
  }
  useEffect(() => { void refresh(); }, []);
  if (openRun) return <PipelineRunDetail runId={openRun} onBack={()=>setOpenRun('')}/>;
  return <div className="pipeline-results">
    <header><div><h1>抓取结果账</h1><p>逐轮核对发现、入库、发布和费用。未记录表示旧日志或供应商未提供该数据。</p></div><button onClick={()=>void refresh()} disabled={pending}>刷新</button></header>
    {error && <p role="alert" className="pipeline-error">读取失败：{error}</p>}
    {!error && pending && <p>正在读取运行记录…</p>}
    {!error && !pending && !runs.length && <section className="panel pipeline-empty">暂无结构化运行记录；下一轮抓取结束后会在这里显示。</section>}
    {runs.map(run => <section className="panel pipeline-run" key={run.id}>
      <div className="pipeline-run-heading"><h2>{time(run.finishedAt)}</h2><button className="pipeline-open" onClick={()=>setOpenRun(run.id)}>查看明细 ›</button><span>{run.status === 'completed' ? '已完成' : run.status === 'failed' ? '失败' : run.status === 'dry_run' ? '试运行' : '仅筛选'}</span></div>
      <div className="pipeline-run-counts">
        <div><span>搜索结果</span><b>{count(run.searchResults)}</b></div>
        <div><span>去重后线索</span><b>{count(run.newLeads)}</b></div>
        <div><span>符合赛事范围</span><b>{count(run.eligibleDiscovered)}</b></div>
        <div><span>新增入库</span><b>{count(run.newRecords)}</b></div>
        <div><span>通过收录初审的新增</span><b>{count(run.qualifiedNew)}</b></div>
        <div><span>实际发布</span><b>{count(run.publishedTotal)}</b></div>
        <div><span>旧记录补齐</span><b>{count(run.existingEnriched)}</b></div>
        <div><span>旧记录发布</span><b>{count(run.publishedExisting)}</b></div>
      </div>
      <p className="pipeline-meta">实际发布中，新赛事 {count(run.publishedNew)}，旧记录 {count(run.publishedExisting)}。抽取成功 {count(run.extractionSucceeded)} / 尝试 {count(run.extractionAttempted)}；Jev筛选 {count(run.jev?.reviewed)}，进入抓取 {count(run.jev?.fetch)}，保留线索 {count(run.jev?.leads)}，拦截 {count(run.jev?.rejected)}。</p>
      <p className="pipeline-meta">已知调用费用：Jev {dollars(run.costsUsd?.jev ?? null)}；正文抽取 {dollars(run.costsUsd?.extraction ?? null)}；入库审核 {dollars(run.costsUsd?.admission ?? null)}；百度搜索 {dollars(run.costsUsd?.baidu ?? null)}。未记录的费用不计入合计。</p>
      <details><summary>查看来源、失败原因与记录标识</summary>
        <div className="pipeline-detail">
          <h3>搜索来源</h3>
          {run.sources?.length ? <ul>{run.sources.map(source=><li key={source.source}>{source.source}：结果 {source.fetched}，新线索 {source.new}，重复 {source.duplicate}，待判重 {source.uncertain}</li>)}</ul> : <p>未记录</p>}
          <h3>失败与跳过</h3>
          {run.failures?.length ? <ul>{run.failures.map((failure,index)=><li key={index}>{failure.stage}：{failure.reason}（{failure.count}）</li>)}</ul> : <p>本轮没有记录到失败原因</p>}
          <h3>数据库记录标识</h3>
          <p>新增：{run.recordIds?.added?.join('、') || '无'}<br/>发布：{run.recordIds?.published?.join('、') || '无'}<br/>补齐：{run.recordIds?.enriched?.join('、') || '无'}</p>
        </div>
      </details>
    </section>)}
  </div>;
}
