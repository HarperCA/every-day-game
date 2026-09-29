// 网页测试版使用统计的汇总（原始事件见 publicData/webEvents.js，存在 web_events）。
// 回答的问题：多少人来过、有没有回来、搜什么、看了哪些赛事、有没有点进官网或报名入口。
// 纯函数，便于测试；日期按北京时间切分。

const DAY_MS = 86400000;
const beijingDate = iso => new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0, 10);

function topCounts(map, limit = 20) {
  return [...map.values()].sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key))).slice(0, limit);
}

function bump(map, key, extra = {}) {
  const entry = map.get(key) || { key, count:0, ...extra };
  entry.count += 1;
  map.set(key, entry);
  return entry;
}

function aggregateWebStats(events, { now = new Date(), days = 30 } = {}) {
  const since = now.getTime() - days * DAY_MS;
  const recent = (events || []).filter(event => Date.parse(event.at) >= since);

  const visitorDays = new Map();       // visitor → 来过的日期
  const firstSeen = new Map();         // visitor → 第一次来的日期（在统计窗口内）
  const daily = new Map();
  const keywords = new Map(), viewed = new Map(), official = new Map(), filters = new Map();
  const officialVisitors = new Set(), detailVisitors = new Set(), devices = new Map();
  const feedback = [];
  let searches = 0, zeroResultSearches = 0, detailViews = 0, officialOpens = 0, copies = 0, favoritesOn = 0, favoritesOff = 0;

  const dayOf = date => {
    if (!daily.has(date)) daily.set(date, { date, visitors:new Set(), newVisitors:0, searches:0, detailViews:0, officialOpens:0 });
    return daily.get(date);
  };

  for (const event of [...recent].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const date = beijingDate(event.at);
    const day = dayOf(date);
    const data = event.data || {};
    day.visitors.add(event.visitor);
    if (!visitorDays.has(event.visitor)) { visitorDays.set(event.visitor, new Set()); firstSeen.set(event.visitor, date); day.newVisitors += 1; }
    visitorDays.get(event.visitor).add(date);
    if (event.type === 'visit') bump(devices, event.device || 'desktop');
    if (event.type === 'search' && data.keyword) {
      searches += 1; day.searches += 1;
      const entry = bump(keywords, data.keyword, { zeroResults:0 });
      if (data.resultCount === 0) { entry.zeroResults += 1; zeroResultSearches += 1; }
    }
    if (event.type === 'filter' && data.kind) bump(filters, `${data.kind}：${data.value || '（清空）'}`);
    if (event.type === 'view_detail' && data.id) {
      detailViews += 1; day.detailViews += 1; detailVisitors.add(event.visitor);
      const entry = bump(viewed, data.id, { name:data.name || data.id, visitors:new Set() });
      entry.visitors.add(event.visitor);
    }
    if (event.type === 'open_official' && data.id) {
      officialOpens += 1; day.officialOpens += 1; officialVisitors.add(event.visitor);
      bump(official, data.id, { name:data.name || data.id });
    }
    if (event.type === 'copy_link') copies += 1;
    if (event.type === 'favorite') { if (data.on === false) favoritesOff += 1; else favoritesOn += 1; }
    if (event.type === 'feedback' && data.text) feedback.push({ at:event.at, id:data.id || '', name:data.name || '', text:data.text });
  }

  const visitors = visitorDays.size;
  const returning = [...visitorDays.values()].filter(set => set.size >= 2).length;
  const rate = (part, whole) => whole ? Math.round(part / whole * 1000) / 10 : 0;
  return {
    days, since:new Date(since).toISOString(), eventCount:recent.length,
    totals:{
      visitors, returningVisitors:returning, returningRate:rate(returning, visitors),
      detailVisitors:detailVisitors.size, detailRate:rate(detailVisitors.size, visitors),
      officialVisitors:officialVisitors.size, officialRate:rate(officialVisitors.size, visitors),
      searches, zeroResultSearches, detailViews, officialOpens, copies, favoritesOn, favoritesOff, feedback:feedback.length,
    },
    devices:Object.fromEntries([...devices.values()].map(item => [item.key, item.count])),
    daily:[...daily.values()].sort((a, b) => a.date.localeCompare(b.date))
      .map(day => ({ date:day.date, visitors:day.visitors.size, newVisitors:day.newVisitors, searches:day.searches, detailViews:day.detailViews, officialOpens:day.officialOpens })),
    topKeywords:topCounts(keywords).map(item => ({ keyword:item.key, count:item.count, zeroResults:item.zeroResults })),
    topViewed:topCounts(viewed).map(item => ({ id:item.key, name:item.name, views:item.count, visitors:item.visitors.size })),
    topOfficial:topCounts(official).map(item => ({ id:item.key, name:item.name, opens:item.count })),
    topFilters:topCounts(filters).map(item => ({ filter:item.key, count:item.count })),
    feedback:feedback.reverse().slice(0, 50),
  };
}

module.exports = { aggregateWebStats, beijingDate };
