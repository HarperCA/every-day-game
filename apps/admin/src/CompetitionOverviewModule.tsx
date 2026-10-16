import { useEffect, useMemo, useState } from 'react';
import { describeCloudError, listPipelineRuns, type PipelineRun } from './adminCloud';
import { summarizePipelineRuns } from './pipelineStatistics';
import './pipelineResults.css';

const time = (value:string | null) => value ? new Date(value).toLocaleString('zh-CN', { timeZone:'Asia/Shanghai' }) : '未记录';

export default function CompetitionOverviewModule({ records }: { records:any[] }) {
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const overview = useMemo(() => summarizePipelineRuns(runs), [runs]);
  const admissionProblems = overview.failures.filter(item => item.stage === 'admission' || item.stage === 'scope');
  const upstreamProblems = overview.failures.filter(item => item.stage !== 'admission' && item.stage !== 'scope');
  const metric = (item: {value:number|null; recordedRuns:number; missingRuns:number}) => <><b>{item.value == null ? '未记录' : item.value}</b><small>有记录 {item.recordedRuns}/{overview.coverage.completedRuns} 轮</small></>;

  async function refresh() {
    setPending(true); setError('');
    try { setRuns((await listPipelineRuns()).runs || []); }
    catch (caught) { setError(describeCloudError(caught)); }
    finally { setPending(false); }
  }
  useEffect(() => { void refresh(); }, []);

  return <div className="pipeline-results">
    <header><div><h1>比赛数据总览</h1><p>查看当前比赛库，以及抓取、入库和发布的整体统计。</p></div><button onClick={()=>void refresh()} disabled={pending}>刷新</button></header>
    <section className="panel pipeline-overview"><h2>当前比赛库</h2><p>按当前后台记录统计届次；同一比赛不同届分别计数。隔离记录也保留在总数中，不代表已确认有效的比赛。</p><div className="pipeline-overview-metrics"><div><span>届次记录总数</span><b>{records.length}</b></div><div><span>已发布</span><b>{records.filter(item => item.dataStatus === 'published').length}</b></div><div><span>草稿及待审核</span><b>{records.filter(item => ['draft','pending_system_validation','pending_manual_review','reviewing'].includes(item.dataStatus)).length}</b></div><div><span>已归档</span><b>{records.filter(item => item.dataStatus === 'archived').length}</b></div><div><span>误收隔离</span><b>{records.filter(item => item.dataStatus === 'quarantined').length}</b></div><div><span>已下架</span><b>{records.filter(item => item.dataStatus === 'offline').length}</b></div></div></section>
    {error && <p role="alert" className="pipeline-error">读取失败：{error}</p>}
    {!error && pending && <p>正在读取运行记录…</p>}
    {!error && !pending && !runs.length && <section className="panel pipeline-empty">暂无结构化运行记录；下一轮抓取结束后会在这里显示。</section>}
    {!error && !pending && runs.length > 0 && <section className="panel pipeline-overview">
      <h2>抓取与入库流水</h2>
      <p>已记录最近 {overview.coverage.totalRuns} 轮，其中完整运行 {overview.coverage.completedRuns} 轮，试运行、仅筛选或失败 {overview.coverage.excludedRuns} 轮不计入汇总。时间范围：{time(overview.coverage.earliestAt)} 至 {time(overview.coverage.latestAt)}。</p>
      <div className="pipeline-overview-metrics"><div><span>搜索返回条目</span>{metric(overview.metrics.searchResults)}</div><div><span>去重后线索</span>{metric(overview.metrics.newLeads)}</div><div><span>通过收录初审</span>{metric(overview.metrics.qualifiedNew)}</div><div><span>新增入库</span>{metric(overview.metrics.newRecords)}</div><div><span>实际发布</span>{metric(overview.metrics.publishedTotal)}</div></div>
      <p className="pipeline-overview-note">以下是候选页面或线索的处理事件数。同一比赛可能在不同来源或轮次重复出现；不同环节也可能记录同一条，不能把问题数相加当作“未入库比赛总数”。缺失的旧日志不按 0 计。</p>
      <h3>读完资料后仍未入库：按问题统计</h3>
      {admissionProblems.length ? <ol className="pipeline-problem-list">{admissionProblems.map(item => <li key={`${item.stage}-${item.reason}`}><span>{item.stage === 'scope' ? '赛事范围' : '入库审核'} · {item.reason}</span><b>{item.count}</b></li>)}</ol> : <p>已记录运行中暂无可归类的入库阻断原因；旧日志可能没有逐条保存。</p>}
      <details><summary>查看前置筛选、读取和抽取阶段的问题</summary>{upstreamProblems.length ? <ol className="pipeline-problem-list">{upstreamProblems.map(item => <li key={`${item.stage}-${item.reason}`}><span>{item.stage === 'pre_filter' ? '前置筛选' : item.stage === 'extraction' ? '读取或抽取' : '流程'} · {item.reason}</span><b>{item.count}</b></li>)}</ol> : <p>暂无记录。</p>}</details>
    </section>}
  </div>;
}
