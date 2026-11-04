// robots.txt 检查：网站说不让抓的就不抓。只提供函数，由 读网页 调用（下载前、每次跳转前）。
// 规则判断搬自 apps/miniprogram/cloudfunctions/adminData/robots.js（最长匹配优先，同样长 Allow 胜出，空 Disallow 不限制）；
// 取 robots.txt 搬自 crawler/lib/fetcher.mjs 的 loadRobots（取不到、或者交回的是网页，按惯例算允许）。
//
//   规则允许(robots 文本, 路径, userAgent)   纯函数
//   建robots检查({ fetchImpl, 超时 })        → 检查(网址) → true / false；每个网站的 robots.txt 只取一次
//   robots允许(网址)                          默认的检查（真的上网，进程里共用一份缓存）
import { USER_AGENT, 限量读取 } from './index.mjs';

function 分组(text) {
  const groups = [];
  let current = null;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === 'user-agent') {
      // 连续的 user-agent 行共享同一组规则
      if (!current || current.rules.length) current = { agents: [], rules: [] };
      current.agents.push(value.toLowerCase());
      if (!groups.includes(current)) groups.push(current);
    } else if ((field === 'allow' || field === 'disallow') && current) {
      current.rules.push({ allow: field === 'allow', path: value });
    }
  }
  return groups;
}

export function 规则允许(text, 路径, userAgent = USER_AGENT) {
  const groups = 分组(text);
  const agent = String(userAgent).toLowerCase();
  const group = groups.find(g => g.agents.some(name => name !== '*' && agent.includes(name))) || groups.find(g => g.agents.includes('*'));
  if (!group) return true;
  let best = null;
  for (const rule of group.rules) {
    if (rule.path === '' || !路径.startsWith(rule.path)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}

export function 建robots检查({ fetchImpl = globalThis.fetch, 超时 = 8000 } = {}) {
  const 缓存 = new Map();   // 网站 → robots.txt 文本（取的时候先放一个进行中的 Promise，同时来的不重复取）
  const 取 = origin => {
    if (!缓存.has(origin)) {
      缓存.set(origin, (async () => {
        try {
          const response = await fetchImpl(`${origin}/robots.txt`, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(超时), redirect: 'follow' });
          if (!response.ok) return '';
          if (/html/i.test(response.headers.get('content-type') || '')) return '';   // 网站用首页兜底 404，不是真的 robots.txt
          return (await 限量读取(response, 256 * 1024)).toString('utf8');
        } catch {
          return '';
        }
      })());
    }
    return 缓存.get(origin);
  };
  return async 网址 => {
    const u = new URL(网址);
    const text = await 取(u.origin);
    return !text || 规则允许(text, u.pathname + u.search);
  };
}

export const robots允许 = 建robots检查();
