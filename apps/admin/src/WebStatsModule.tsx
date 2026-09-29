import { useEffect, useState } from 'react';
import { describeCloudError, getWebStats, type WebStats } from './adminCloud';
import './webStats.css';

// 网页测试版（/app/）的匿名使用统计：用来判断学生到底需不需要这个产品。
// 最关键的指标是“点进官方报名页的人数占比”和“回访率”。
const RANGES = [7, 30, 90];
const time = (iso:string) => new Date(iso).toLocaleString('zh-CN', { timeZone:'Asia/Shanghai', hour12:false });

export default function WebStatsModule() {
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<WebStats | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  async function refresh(range = days) {
    setPending(true); setError('');
    try { setStats(await getWebStats(range)); }
    catch (caught) { setError(describeCloudError(caught)); }
    finally { setPending(false); }
  }
  useEffect(() => { void refresh(days); }, [days]);
  const t = stats?.totals;
  const url = `${location.origin}/app/`;
  return <div className="web-stats">
    <header><div><h1>测试版统计</h1><p>网页测试版 <a href={url} target="_blank" rel="noreferrer">{url}</a> 的匿名使用情况。不含个人信息，每个浏览器算一个访客。</p></div>
      <div className="web-stats-actions">{RANGES.map(range => <button key={range} className={range === days ? 'active' : ''} onClick={()=>setDays(range)}>近{range}天</button>)}<button onClick={()=>void refresh()} disabled={pending}>刷新</button></div></header>
    {error && <p role="alert" className="web-stats-error">读取失败：{error}</p>}
    {!error && pending && !stats && <p>正在读取…</p>}
    {stats && t && <>
      {!stats.eventCount && <section className="panel web-stats-empty">这段时间还没有访问记录。把测试版链接发给同学后，这里会显示使用情况。</section>}
      <section className="web-stats-cards">
        <div><span>访客</span><b>{t.visitors}</b><small>手机 {stats.devices.mobile || 0} · 电脑 {stats.devices.desktop || 0}（按打开次数）</small></div>
        <div><span>回访访客</span><b>{t.returningVisitors}</b><small>占 {t.returningRate}%：不同日期来过 2 次及以上</small></div>
        <div className="key"><span>点进官方报名页的访客</span><b>{t.officialVisitors}</b><small>占 {t.officialRate}%，共点击 {t.officialOpens} 次；另复制链接 {t.copies} 次</small></div>
        <div><span>看过赛事详情的访客</span><b>{t.detailVisitors}</b><small>占 {t.detailRate}%，共浏览 {t.detailViews} 次</small></div>
        <div><span>搜索</span><b>{t.searches}</b><small>其中 {t.zeroResultSearches} 次没搜到结果</small></div>
        <div><span>收藏</span><b>{t.favoritesOn}</b><small>取消 {t.favoritesOff} 次</small></div>
        <div><span>信息纠错</span><b>{t.feedback}</b><small>见本页最下方</small></div>
      </section>
      <section className="panel"><h2>每天</h2>
        <table><thead><tr><th>日期</th><th>访客</th><th>新访客</th><th>搜索</th><th>看详情</th><th>点官方页</th></tr></thead>
          <tbody>{[...stats.daily].reverse().map(day => <tr key={day.date}><td>{day.date}</td><td>{day.visitors}</td><td>{day.newVisitors}</td><td>{day.searches}</td><td>{day.detailViews}</td><td>{day.officialOpens}</td></tr>)}</tbody></table></section>
      <div className="web-stats-grid">
        <section className="panel"><h2>搜索词</h2><p className="hint">没搜到结果的词，说明库里可能缺这类赛事。</p>
          <table><thead><tr><th>关键词</th><th>次数</th><th>没结果</th></tr></thead><tbody>{stats.topKeywords.map(item => <tr key={item.keyword} className={item.zeroResults ? 'zero' : ''}><td>{item.keyword}</td><td>{item.count}</td><td>{item.zeroResults || ''}</td></tr>)}</tbody></table></section>
        <section className="panel"><h2>最常看的赛事</h2>
          <table><thead><tr><th>赛事</th><th>浏览</th><th>人数</th></tr></thead><tbody>{stats.topViewed.map(item => <tr key={item.id}><td>{item.name}</td><td>{item.views}</td><td>{item.visitors}</td></tr>)}</tbody></table></section>
        <section className="panel"><h2>点进官方页最多的赛事</h2>
          <table><thead><tr><th>赛事</th><th>点击</th></tr></thead><tbody>{stats.topOfficial.map(item => <tr key={item.id}><td>{item.name}</td><td>{item.opens}</td></tr>)}</tbody></table></section>
        <section className="panel"><h2>常用筛选</h2>
          <table><thead><tr><th>筛选</th><th>次数</th></tr></thead><tbody>{stats.topFilters.map(item => <tr key={item.filter}><td>{item.filter}</td><td>{item.count}</td></tr>)}</tbody></table></section>
      </div>
      <section className="panel"><h2>信息纠错</h2>{stats.feedback.length ? <ul className="web-stats-feedback">{stats.feedback.map((item, index) => <li key={`${item.at}-${index}`}><b>{item.name || item.id}</b><time>{time(item.at)}</time><p>{item.text}</p></li>)}</ul> : <p className="hint">暂无。</p>}</section>
    </>}
  </div>;
}
