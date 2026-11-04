// 已知读不了的网站：robots.txt 不允许抓取，放行去读也必然失败（2026-10-01 用户定）。搬自 scripts/server/unreadable-hosts.mjs。
// 这些站的页面不去读详情，改去追溯：用标题或摘要里的比赛名去找官网。名单只放有实测依据的站，新发现读不了的再补。
export const 读不了的网站 = ['mp.weixin.qq.com', 'baike.baidu.com'];

export function 读不了(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return 读不了的网站.some(item => host === item || host.endsWith(`.${item}`));
  } catch {
    return false;
  }
}
