// "可复用信源资产"：抓取流水线每次发现新赛事时，把它来自的网站域名记下来
// （不是记赛事本身——赛事本身已经在 competitions 里了），攒成一份越来越完整
// 的"这类信源在哪"清单。天池/DataFountain/赛氪这类已知聚合平台不值得记，
// 因为流水线本来就固定在爬它们；真正有价值的是百度AI搜索挖出来的、之前不
// 知道的信源——某个省教育厅、某个高校教务处/团委——因为下次同类赛事很可能
// 还在同一个网站上发通知。
//
// 按域名去重（不是按URL）：同一个网站发过10条通知，只算1个信源，但
// admittedCount 累加，见得越多说明这个信源越稳定可信。
import { hostOf } from './dedupe.mjs';

export const KNOWN_AGGREGATOR_HOSTS = ['tianchi.aliyun.com', 'datafountain.cn', 'saikr.com'];

export function isKnownAggregator(host) {
  return KNOWN_AGGREGATOR_HOSTS.some(known => host === known || host.endsWith(`.${known}`));
}

// 粗略分类，帮管理员一眼看出这个信源是什么性质，不追求精确。
export function classifySourceType(host) {
  if (/\.gov\.cn$/i.test(host)) return '政府/教育主管部门';
  if (/\.edu\.cn$/i.test(host)) return '高校官网';
  if (/(mp\.weixin\.qq\.com|weixin)/i.test(host)) return '微信公众号文章';
  return '其他网站';
}

// candidates: [{ url, name, query }]，来自已经判定 admit 的候选。
export function extractChannelEntries(candidates) {
  const entries = [];
  for (const candidate of candidates) {
    const host = hostOf(candidate.url || candidate.detailUrl);
    if (!host || isKnownAggregator(host)) continue;
    entries.push({ host, url: candidate.url || candidate.detailUrl, name: candidate.name, query: candidate.query || candidate.matchedQuery || null });
  }
  return entries;
}

// existing: 已有的 { [host]: channel } 对象（首次运行传 {} 即可）。不修改入参。
export function mergeDiscoveredChannels(existing, entries, now = new Date().toISOString()) {
  const channels = { ...(existing || {}) };
  for (const entry of entries) {
    if (!entry?.host) continue;
    const prev = channels[entry.host];
    channels[entry.host] = {
      host: entry.host,
      sourceType: classifySourceType(entry.host),
      sampleUrl: entry.url || prev?.sampleUrl || '',
      sampleCompetitionName: entry.name || prev?.sampleCompetitionName || '',
      firstSeenAt: prev?.firstSeenAt || now,
      lastSeenAt: now,
      admittedCount: (prev?.admittedCount || 0) + 1,
      queries: Array.from(new Set([...(prev?.queries || []), entry.query].filter(Boolean))).slice(0, 10),
    };
  }
  return channels;
}

export { hostOf };
