import { useEffect, useState } from 'react';
import { describeCloudError, getClientIssues, type ClientIssueReport } from './adminCloud';
import './clientIssues.css';

// 后台“访问异常”页（2026-10-01 起）：小程序在用户手机上出的问题。
// 数据来源：小程序出错时匿名上报到腾讯云开发上海的 clientLog，服务器每 5 分钟拉回本地。
const percent = (value:number | null) => value == null ? '—' : `${(value * 100).toFixed(value >= 0.995 && value < 1 ? 1 : 0)}%`;
const time = (value:string) => value ? new Date(value).toLocaleString('zh-CN', { timeZone:'Asia/Shanghai' }) : '';
const NETWORK: Record<string, string> = { wifi:'Wi-Fi', '4g':'4G', '5g':'5G', '3g':'3G', '2g':'2G', none:'无网络', unknown:'未知' };

export default function ClientIssuesModule() {
  const [days, setDays] = useState(14);
  const [report, setReport] = useState<ClientIssueReport | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  async function refresh(range = days) {
    setPending(true); setError('');
    try { setReport(await getClientIssues(range)); }
    catch (caught) { setError(describeCloudError(caught)); }
    finally { setPending(false); }
  }
  useEffect(() => { void refresh(days); }, [days]);
  const labels = report?.kindLabels || {};
  return <div className="client-issues">
    <header>
      <div><h1>访问异常</h1><p>小程序在用户手机上出的问题：加载失败、加载慢、从上海退回美国服务器、登录收藏提醒失败、程序报错。匿名记录，不含身份信息；手机断网时先存着，下次打开再补发，所以数字可能晚到几分钟到几天。</p></div>
      <div className="client-issues-actions">
        <select value={days} onChange={event => setDays(Number(event.target.value))}><option value={1}>今天</option><option value={7}>最近 7 天</option><option value={14}>最近 14 天</option><option value={30}>最近 30 天</option></select>
        <button onClick={() => void refresh()} disabled={pending}>刷新</button>
      </div>
    </header>
    {error && <p role="alert" className="client-issues-error">读取失败：{error}</p>}
    {!error && pending && !report && <p>正在读取…</p>}
    {report && <>
      <section className="panel client-issues-summary">
        <div><span>加载成功率</span><b className={report.summary.successRate != null && report.summary.successRate < 0.98 ? 'bad' : ''}>{percent(report.summary.successRate)}</b><small>{report.summary.attempts} 次加载</small></div>
        {Object.entries(labels).map(([kind, label]) => <div key={kind}><span>{label}</span><b className={kind === 'load_failed' && report.byKind[kind] ? 'bad' : ''}>{report.byKind[kind] || 0}</b><small>次</small></div>)}
      </section>
      <section className="panel">
        <h2>每天</h2>
        <div className="table-wrap"><table><thead><tr><th>日期</th><th>加载成功率</th><th>上海成功</th><th>退回美国</th><th>加载失败</th><th>加载慢</th><th>登录/收藏/提醒失败</th><th>代码报错</th></tr></thead>
          <tbody>{report.daily.map(day => <tr key={day.date}><td>{day.date}</td><td className={day.successRate != null && day.successRate < 0.98 ? 'bad' : ''}>{percent(day.successRate)}</td><td>{day.shanghaiOk}</td><td>{day.fallback}</td><td className={day.failed ? 'bad' : ''}>{day.failed}</td><td>{day.slow}</td><td>{day.userDataFailed}</td><td>{day.jsError}</td></tr>)}</tbody></table></div>
      </section>
      <section className="panel client-issues-split">
        <div><h2>按网络</h2>{Object.keys(report.byNetwork).length ? <ul>{Object.entries(report.byNetwork).sort((a, b) => b[1] - a[1]).map(([key, value]) => <li key={key}><span>{NETWORK[key] || key}</span><b>{value}</b></li>)}</ul> : <p className="muted">没有异常</p>}</div>
        <div><h2>按操作</h2>{Object.keys(report.byAction).length ? <ul>{Object.entries(report.byAction).sort((a, b) => b[1] - a[1]).map(([key, value]) => <li key={key}><span>{key}</span><b>{value}</b></li>)}</ul> : <p className="muted">没有异常</p>}</div>
      </section>
      <section className="panel">
        <h2>最近的异常（最多 100 条）</h2>
        {report.recent.length ? <div className="table-wrap"><table><thead><tr><th>时间</th><th>类型</th><th>页面 / 操作</th><th>错误信息</th><th>耗时</th><th>网络</th><th>设备</th></tr></thead>
          <tbody>{report.recent.map((issue, index) => <tr key={`${issue.at}-${index}`}>
            <td>{time(issue.at)}</td>
            <td className={issue.kind === 'load_failed' ? 'bad' : ''}>{labels[issue.kind] || issue.kind}</td>
            <td>{issue.page}<small>{issue.action}</small></td>
            <td>{issue.message}{issue.extra && <small>{issue.extra}</small>}</td>
            <td>{issue.elapsed_ms != null ? `${(issue.elapsed_ms / 1000).toFixed(1)} 秒` : ''}</td>
            <td>{NETWORK[issue.networkType] || issue.networkType}</td>
            <td><small>{issue.platform} {issue.system}</small><small>微信 {issue.wechatVersion} · 小程序 {issue.appVersion || issue.envVersion}</small></td>
          </tr>)}</tbody></table></div> : <p className="muted">这段时间没有异常记录。</p>}
      </section>
    </>}
  </div>;
}
