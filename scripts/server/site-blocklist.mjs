// 百度搜索的屏蔽网站名单（2026-10-12，用户定）：夜间搜索、通知追溯用百度时都带上这份名单（block_websites，屏蔽该站及其子站）。
//
// 两部分：
//   内置名单 BUILTIN_BLOCKED：写在这里，改动要改代码。
//   后台确认的名单：每周一 site-block-suggest.mjs 统计近 30 天的搜索结果，把“出现很多次、却一次都没被放行或追溯成功”的网站
//   列为“建议屏蔽”，在后台“屏蔽网站”页确认后才生效（存在后台 admin_state 的 site_blocklist），不自动加。
//
// 屏蔽只对百度有效（Kimi 搜索接口没有这个参数）；按调用次数计费，屏蔽不省搜索次数，省的是结果位置和后面判重、筛选、追溯的开销。
// 学校网站（edu.cn）不进建议名单：学校转发的通知要用来追溯上级赛事。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const BUILTIN_BLOCKED = [
  { host:'zhihu.com', reason:'问答站，转述别人的内容' },
  { host:'sohu.com', reason:'转载' },
  { host:'baijiahao.baidu.com', reason:'自媒体转载' },
  { host:'52jingsai.com', reason:'竞赛信息聚合站（子站一并屏蔽，挂在子站下的官网改由通知追溯找）' },
  { host:'saikr.com', reason:'竞赛信息聚合站' },
  // 2026-10-12 起
  { host:'tianchi.aliyun.com', reason:'已有专门抓取器，搜到也会被丢掉，白占结果位置' },
  { host:'datafountain.cn', reason:'2026-09-30 停用的来源，搜到也会被丢掉' },
  { host:'baike.baidu.com', reason:'百科不是原文；10/11、10/12 两晚通知追溯 50 篇只找到 4 个官方来源，平均 20 万 token 一个' },
  { host:'mp.weixin.qq.com', reason:'公众号文章不允许抓取、读不了；两晚通知追溯 64 篇找到 5 个，平均 14 万 token 一个' },
];
export const BUILTIN_HOSTS = BUILTIN_BLOCKED.map(item => item.host);

// 只要域名：去掉协议、路径、端口和开头的 www.，转小写；不像域名的返回空串
export function normalizeHost(value) {
  const host = String(value || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^www\./, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : '';
}

// 某个网址或域名是否已被名单覆盖（名单里的站及其子站）
export function isBlockedHost(value, hosts) {
  const host = normalizeHost(value);
  return Boolean(host) && hosts.some(item => host === item || host.endsWith(`.${item}`));
}

// 内置名单 + 后台确认的名单，去重
export function mergeBlocked(confirmed = []) {
  const out = [...BUILTIN_HOSTS];
  for (const item of confirmed) {
    const host = normalizeHost(typeof item === 'string' ? item : item?.host);
    if (host && !out.includes(host)) out.push(host);
  }
  return out;
}

function readToken(here) {
  try { return fs.readFileSync(path.join(here, '.admin-token'), 'utf8').trim(); } catch { return ''; }
}

// 读后台确认的名单并和内置名单合并。读不到（后台没起、没口令）就只用内置名单，不影响搜索
let cached = null;
export function loadBlockedSites({ here = HERE, apiBase = process.env.API_BASE || 'http://127.0.0.1:8787', fetchImpl = globalThis.fetch, log = () => {}, fresh = false } = {}) {
  if (cached && !fresh) return cached;
  cached = (async () => {
    const token = readToken(here);
    if (!token) return BUILTIN_HOSTS;
    try {
      const response = await fetchImpl(`${apiBase}/api/adminData`, {
        method:'POST', headers:{ 'content-type':'application/json' },
        body:JSON.stringify({ adminToken:token, action:'siteBlocklist' }), signal:AbortSignal.timeout(10000),
      });
      const result = await response.json();
      if (!result?.ok) throw new Error(result?.message || `HTTP ${response.status}`);
      return mergeBlocked(result.data?.blocked || []);
    } catch (error) {
      log(`屏蔽名单：读后台确认的名单失败，只用内置名单（${String(error?.message || error).slice(0, 120)}）`);
      return BUILTIN_HOSTS;
    }
  })();
  return cached;
}
