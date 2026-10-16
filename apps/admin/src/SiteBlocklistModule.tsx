import { useEffect, useState } from 'react';
import { decideSiteBlock, describeCloudError, getSiteBlocklist, type SiteBlocklist } from './adminCloud';
import './clientIssues.css';

// 后台“屏蔽网站”页（2026-10-12 起）：百度搜索带上的屏蔽名单（block_websites，屏蔽该站及其子站）。
// 内置名单写在服务器 site-blocklist.mjs；每周一统计近 30 天的搜索结果，把“出现很多次、一次都没被放行或追溯成功”的网站
// 列为建议，这里确认后才加入名单，下一次搜索起生效。屏蔽不省百度的调用次数，省的是结果位置和后面判重、筛选、追溯的开销。
const time = (value:string) => value ? new Date(value).toLocaleString('zh-CN', { timeZone:'Asia/Shanghai', hour12:false }) : '—';
const runDate = (id:string) => id ? id.slice(0, 10) : '—';

export default function SiteBlocklistModule() {
  const [data, setData] = useState<SiteBlocklist | null>(null);
  const [pending, setPending] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  async function refresh() {
    setPending(true); setError('');
    try { setData(await getSiteBlocklist()); }
    catch (caught) { setError(describeCloudError(caught)); }
    finally { setPending(false); }
  }
  useEffect(() => { void refresh(); }, []);
  async function decide(host:string, decision:'block'|'dismiss'|'unblock'|'restore') {
    setBusy(host); setError('');
    try { setData(await decideSiteBlock(host, decision)); }
    catch (caught) { setError(describeCloudError(caught)); }
    finally { setBusy(''); }
  }

  return <div className="client-issues">
    <header>
      <div><h1>屏蔽网站</h1><p>每晚百度搜索不返回这些网站（及其子站）的结果，空出的位置留给别的网站。只对百度有效；按次计费，屏蔽不省搜索次数，省的是后面判重、筛选和 AI 追溯的开销。每周一 09:00 统计一次“建议屏蔽”，在这里确认后从下一次搜索起生效。</p></div>
      <div className="client-issues-actions"><button onClick={() => void refresh()} disabled={pending}>刷新</button></div>
    </header>
    {error && <p role="alert" className="client-issues-error">操作失败：{error}</p>}
    {!error && pending && !data && <p>正在读取…</p>}
    {data && <>
      <section className="panel">
        <h2>建议屏蔽（{data.suggestions.length}）</h2>
        <p className="muted">{data.generatedAt
          ? `统计于 ${time(data.generatedAt)}：近 ${data.windowDays} 天 ${data.runs} 晚的百度结果里，出现 ${data.minRefs} 次以上、一次都没被放行去读详情、也没追溯出官方来源的网站。学校网站（edu.cn）和库里赛事的来源网站不会列出。`
          : '还没有统计过，每周一 09:00 自动统计。'}</p>
        {data.suggestions.length ? <div className="table-wrap"><table>
          <thead><tr><th>网站</th><th>出现次数</th><th>情况</th><th>例子</th><th>操作</th></tr></thead>
          <tbody>{data.suggestions.map(item => <tr key={item.host}>
            <td><b>{item.host}</b><small>{runDate(item.firstSeen)} ～ {runDate(item.lastSeen)}</small></td>
            <td><b>{item.refs}</b></td>
            <td>{item.reason}</td>
            <td>{item.samples.map(sample => <small key={sample.url}><a href={sample.url} target="_blank" rel="noreferrer">{sample.title || sample.url}</a></small>)}</td>
            <td><button onClick={() => void decide(item.host, 'block')} disabled={Boolean(busy)}>确认屏蔽</button> <button onClick={() => void decide(item.host, 'dismiss')} disabled={Boolean(busy)}>不屏蔽</button></td>
          </tr>)}</tbody>
        </table></div> : <p className="muted">没有新的建议。</p>}
      </section>

      <section className="panel">
        <h2>已屏蔽（内置 {data.builtin.length}，后台确认 {data.blocked.length}）</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>网站</th><th>来源</th><th>原因</th><th>操作</th></tr></thead>
          <tbody>
            {data.blocked.map(item => <tr key={item.host}>
              <td><b>{item.host}</b></td><td>后台确认<small>{time(item.decidedAt)}</small></td><td>{item.reason || '—'}</td>
              <td><button onClick={() => void decide(item.host, 'unblock')} disabled={Boolean(busy)}>取消屏蔽</button></td>
            </tr>)}
            {data.builtin.map(item => <tr key={item.host}>
              <td><b>{item.host}</b></td><td>内置</td><td>{item.reason}</td><td className="muted">改代码才能去掉</td>
            </tr>)}
          </tbody>
        </table></div>
        {!data.builtin.length && <p className="muted">内置名单在第一次统计后显示。</p>}
      </section>

      {data.dismissed.length > 0 && <section className="panel">
        <h2>决定不屏蔽（{data.dismissed.length}）</h2>
        <p className="muted">之后的统计不再建议这些网站；点“恢复”后，下一次统计还可能再列出。</p>
        <div className="table-wrap"><table>
          <thead><tr><th>网站</th><th>决定时间</th><th>操作</th></tr></thead>
          <tbody>{data.dismissed.map(item => <tr key={item.host}>
            <td><b>{item.host}</b>{item.refs ? <small>当时出现 {item.refs} 次</small> : null}</td><td>{time(item.decidedAt)}</td>
            <td><button onClick={() => void decide(item.host, 'restore')} disabled={Boolean(busy)}>恢复</button></td>
          </tr>)}</tbody>
        </table></div>
      </section>}
    </>}
  </div>;
}
