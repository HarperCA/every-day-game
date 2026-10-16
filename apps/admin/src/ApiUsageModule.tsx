import { useEffect, useMemo, useState } from 'react';
import { describeCloudError, getApiUsage, type ApiUsageCell, type ApiUsageReport } from './adminCloud';
import './clientIssues.css';

// 后台“接口用量”页（2026-10-10 起）：服务器上每个后台进程调用外部接口（百度、Kimi、DeepSeek、OpenRouter、微信）时
// 自动记一笔账（scripts/server/api-usage.mjs），这里按天汇总、按使用位置细分。只记账开始之后的调用，之前的没有记录。
const time = (value:string) => value ? new Date(value).toLocaleString('zh-CN', { timeZone:'Asia/Shanghai', hour12:false }) : '—';
const tokens = (n:number) => !n ? '' : n >= 10000 ? `${(n / 10000).toFixed(1)} 万 token` : `${n} token`;
const usd = (n:number) => n ? `$${n.toFixed(4)}` : '';

function Cell({ cell }:{ cell?:ApiUsageCell }) {
  if (!cell || !cell.calls) return <td className="muted">—</td>;
  const extra = [tokens(cell.tokens), usd(cell.costUsd)].filter(Boolean).join('，');
  return <td><b>{cell.calls}</b> 次{cell.failed ? <span className="bad">（失败 {cell.failed}）</span> : null}{extra && <small>{extra}</small>}</td>;
}

export default function ApiUsageModule() {
  const [days, setDays] = useState(14);
  const [report, setReport] = useState<ApiUsageReport | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [date, setDate] = useState('');
  const [api, setApi] = useState('');
  async function refresh(count = days) {
    setPending(true); setError('');
    try { const data = await getApiUsage(count); setReport(data); setDate(current => current && data.dates.includes(current) ? current : data.dates[0]); }
    catch (caught) { setError(describeCloudError(caught)); }
    finally { setPending(false); }
  }
  useEffect(() => { void refresh(days); }, [days]);
  const today = report?.days[0];
  const details = useMemo(() => (report?.details || []).filter(row => (!date || row.date === date) && (!api || row.api === api)), [report, date, api]);
  const used = (id:string) => (report?.days || []).some(day => day.apis[id]?.calls);

  return <div className="client-issues">
    <header>
      <div><h1>接口用量</h1><p>各个外部接口每天用了多少、用在哪里。服务器上每个后台程序调用百度、Kimi、DeepSeek、OpenRouter、微信接口时都会自动记一笔（成功与否、token、费用、错误码）。只统计记账开始后的调用{report?.since ? `（最早记录 ${report.since}）` : ''}，日期按北京时间。</p></div>
      <div className="client-issues-actions">
        <select value={days} onChange={event => setDays(Number(event.target.value))}><option value={7}>最近 7 天</option><option value={14}>最近 14 天</option><option value={30}>最近 30 天</option></select>
        <button onClick={() => void refresh()} disabled={pending}>刷新</button>
      </div>
    </header>
    {error && <p role="alert" className="client-issues-error">读取失败：{error}</p>}
    {!error && pending && !report && <p>正在读取…</p>}
    {report && <>
      <section className="panel">
        <h2>今天（{report.dates[0]}）</h2>
        <div className="client-issues-summary">
          {report.apis.map(meta => {
            const cell = today?.apis[meta.id];
            return <div key={meta.id} title={meta.quota}><span>{meta.label}</span>
              <b className={cell?.failed ? 'bad' : ''}>{cell?.calls || 0}<small> 次</small></b>
              <small>{meta.id === 'baidu_search' ? `自动任务 ${report.baiduToday.auto}/${report.baiduToday.limit}，测试 ${report.baiduToday.manual}` : [tokens(cell?.tokens || 0), usd(cell?.costUsd || 0)].filter(Boolean).join('，') || meta.quota}</small>
              {cell?.failed ? <small className="bad">失败 {cell.failed} 次</small> : null}</div>;
          })}
        </div>
      </section>

      <section className="panel">
        <h2>总调度汇总（每天 × 每个接口）</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>日期</th><th>合计</th>{report.apis.map(meta => <th key={meta.id} title={meta.quota}>{meta.label}</th>)}</tr></thead>
          <tbody>{report.days.map(day => <tr key={day.date} className={day.date === date ? 'selected' : ''} onClick={() => setDate(day.date)} style={{ cursor:'pointer' }}>
            <td>{day.date}</td><td><b>{day.total}</b> 次</td>
            {report.apis.map(meta => <Cell key={meta.id} cell={day.apis[meta.id]} />)}
          </tr>)}</tbody>
        </table></div>
        <p className="muted">点某一天，下面的细分表就显示那天的明细。各接口额度：{report.apis.filter(meta => used(meta.id) || meta.id === 'baidu_search').map(meta => `${meta.label}：${meta.quota}`).join('；')}。</p>
      </section>

      <section className="panel">
        <h2>细分（接口 × 使用位置）</h2>
        <div className="client-issues-actions" style={{ marginBottom:10 }}>
          <select value={date} onChange={event => setDate(event.target.value)}>{report.dates.map(item => <option key={item} value={item}>{item}</option>)}</select>
          <select value={api} onChange={event => setApi(event.target.value)}><option value="">全部接口</option>{report.apis.map(meta => <option key={meta.id} value={meta.id}>{meta.label}</option>)}</select>
        </div>
        {details.length ? <div className="table-wrap"><table>
          <thead><tr><th>接口</th><th>使用位置</th><th>调用</th><th>成功</th><th>失败（主要原因）</th><th>token（输入 / 输出）</th><th>费用</th><th>平均耗时</th><th>最后一次</th></tr></thead>
          <tbody>{details.map(row => <tr key={`${row.date}|${row.api}|${row.caller}`}>
            <td>{row.apiLabel}</td>
            <td>{row.callerLabel}{row.callerLabel !== row.caller && <small>{row.caller}</small>}</td>
            <td><b>{row.calls}</b></td><td>{row.ok}</td>
            <td className={row.failed ? 'bad' : ''}>{row.failed || ''}{row.errors.length ? <small>{row.errors.slice(0, 3).map(item => `${item.code} ×${item.count}`).join('，')}</small> : null}</td>
            <td>{row.tokens ? <>{tokens(row.tokens)}<small>{row.tokensIn} / {row.tokensOut}</small></> : <span className="muted">—</span>}</td>
            <td>{usd(row.costUsd) || <span className="muted">—</span>}</td>
            <td>{row.avgMs ? `${(row.avgMs / 1000).toFixed(1)} 秒` : '—'}</td>
            <td>{time(row.lastAt)}</td>
          </tr>)}</tbody>
        </table></div> : <p className="muted">这一天{api ? '这个接口' : ''}没有调用记录。</p>}
      </section>
    </>}
  </div>;
}
