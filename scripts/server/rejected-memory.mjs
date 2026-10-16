// 被拒网址的记忆：前置筛选拦下的、读了详情却没能入库的，记住 30 天，期间不再重复处理。
//
// 为什么需要：被拒的候选不在库里，判重拦不住它们。天池、DataFountain 列表上的赛题、
// 学校栏目页等会被每晚重新抓到、再读一遍详情、再被拒一次，白白占用每晚只有几个的读详情名额。
// 读详情失败（网络问题）的不记，下次还能再试。30 天后自动忘掉，页面内容变了还有机会重新判断。
import fs from 'node:fs';

// 和 crawler/lib/dedupe.mjs 的 urlKey 相同（不跨目录引用：仓库里和服务器上的目录结构不一样）：
// 不分 http/https、忽略 www、结尾斜杠和 # 锚点，保留路径和查询参数
export function urlKey(url) {
  try {
    const u = new URL(String(url || ''));
    if (!/^https?:$/.test(u.protocol)) return '';
    return `${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch { return ''; }
}

export const REMEMBER_DAYS = 30;

export function loadMemory(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data.urls === 'object' ? data : { urls:{} };
  } catch {
    return { urls:{} };
  }
}

export function recentlyRejected(memory, url, now = Date.now(), days = REMEMBER_DAYS) {
  const entry = memory.urls[urlKey(url)];
  return Boolean(entry && now - Date.parse(entry.at) < days * 86400000);
}

// entries：[{ url, reason, stage }]；顺带清掉过期的
export function remember(memory, entries, now = new Date(), days = REMEMBER_DAYS) {
  const cutoff = now.getTime() - days * 86400000;
  const urls = Object.fromEntries(Object.entries(memory.urls).filter(([, entry]) => Date.parse(entry.at) >= cutoff));
  for (const entry of entries) {
    const key = urlKey(entry.url);
    if (key) urls[key] = { at:now.toISOString(), reason:String(entry.reason || '').slice(0, 120), stage:entry.stage || '' };
  }
  return { urls };
}

export function saveMemory(file, memory) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(memory), 'utf8');
  fs.renameSync(temporary, file);
}
