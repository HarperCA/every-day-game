import { useEffect, useState } from 'react';
import { describeCloudError, getPreferenceStats, type PreferenceStats } from './adminCloud';
import './clientIssues.css';

// 后台“问卷统计”页（2026-10-09 起）：小程序首次打开的偏好问卷，登录用户的答案存进账号（上海 userData 的 user_preference），
// 服务器每 5 分钟经 publicSync 拉回一份计数快照。只有计数，看不到是谁填的；没登录的用户答案只在手机本地，不计入。
const time = (value:string) => value ? new Date(value).toLocaleString('zh-CN', { timeZone:'Asia/Shanghai' }) : '未记录';
const percent = (n:number, total:number) => total ? `${Math.round(n / total * 100)}%` : '—';

function Ranking({ title, counts, base, extra }:{ title:string; counts:Record<string, number>; base:number; extra?:[string, number] }) {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (extra && extra[1]) rows.push(extra);
  return <section className="panel">
    <h2>{title}</h2>
    {rows.length ? <table><thead><tr><th>选项</th><th>人数</th><th>占填完人数</th></tr></thead>
      <tbody>{rows.map(([key, n]) => <tr key={key}><td>{key}</td><td>{n}</td><td>{percent(n, base)}</td></tr>)}</tbody></table>
      : <p>还没有数据。</p>}
  </section>;
}

export default function PreferenceStatsModule() {
  const [stats, setStats] = useState<PreferenceStats | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  async function refresh() {
    setPending(true); setError('');
    try { setStats(await getPreferenceStats()); }
    catch (caught) { setError(describeCloudError(caught)); }
    finally { setPending(false); }
  }
  useEffect(() => { void refresh(); }, []);
  return <div className="client-issues">
    <header>
      <div><h1>问卷统计</h1><p>首次打开小程序的偏好问卷（专业、关心的比赛大类、省份）。只统计已登录用户存进账号的答案，没登录的只存在手机本地，不计入。每 5 分钟从上海同步一次。</p></div>
      <div className="client-issues-actions"><button onClick={() => void refresh()} disabled={pending}>刷新</button></div>
    </header>
    {error && <p role="alert">读取失败：{error}</p>}
    {!error && pending && <p>正在读取…</p>}
    {!error && !pending && !stats && <section className="panel">还没有同步到问卷数据：上海的 userData、publicSync 两个云函数部署新版本后，有登录用户填写或跳过问卷，这里就会出现。</section>}
    {!error && !pending && stats && <>
      <section className="panel">
        <h2>总体</h2>
        <p>账号数 <b>{stats.total}</b>：填完 <b>{stats.completed}</b>（{percent(stats.completed, stats.total)}），跳过 <b>{stats.skipped}</b>（{percent(stats.skipped, stats.total)}）。</p>
        <p>上海统计时间：{time(stats.generatedAt)}；服务器拉取时间：{time(stats.pulledAt)}</p>
      </section>
      <Ranking title="专业" counts={stats.profession} base={stats.completed} extra={['没选专业', stats.noProfession]} />
      <Ranking title="关心的比赛大类（多选，一人可算多次）" counts={stats.categories} base={stats.completed} extra={['不限', stats.noCategory]} />
      <Ranking title="省份" counts={stats.province} base={stats.completed} extra={['不限', stats.noProvince]} />
    </>}
  </div>;
}
