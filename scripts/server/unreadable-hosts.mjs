// 已知读不了的网站：robots.txt 不允许抓取，放行去读也必然失败（2026-10-01，用户定）。
//
// 这些站的页面不去读详情，改成转进通知追溯：用标题或摘要里的赛事名去搜赛事官网。
// 依据是近 5 晚的实测：每晚被 robots 拦下的 2～4 条几乎全是 mp.weixin.qq.com（微信公众号文章），
// 另有 baike.baidu.com。名单只放有实测依据的站，新发现读不了的再补。
const UNREADABLE_HOSTS = ['mp.weixin.qq.com', 'baike.baidu.com'];

export function isUnreadableHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return UNREADABLE_HOSTS.some(item => host === item || host.endsWith(`.${item}`));
  } catch { return false; }
}

export { UNREADABLE_HOSTS };
