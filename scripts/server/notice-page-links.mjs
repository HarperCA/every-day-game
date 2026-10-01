// 通知追溯的第一种办法：直接访问通知页面，把页面里写出的网址（官网、报名入口、报名平台）提取出来（2026-10-01，用户定）。
//
// 追溯分两种：
//   ① 页面能读：直接访问，提取页面里的网址——不花搜索额度，网址是通知自己写的，比搜索搜到的可靠；
//   ② 已经知道比赛名、但页面读不了（微信公众号等）或页面里没写网址：用“比赛名 报名入口”去搜，找最新的官网（resolve-notice-leads.mjs）。
//
// 只要指向别的网站的链接（同一个学校网站的导航、栏目、附件不要），并且：
//   正文里直接写出的网址，或者链接文字/网址里带“官网、报名、大赛、竞赛、组委会”这类字样的（“平台”太宽，“网络教学平台”也会命中，不用）。
// 公众号、百科、问答这类（leadRank 9）不要；PDF、Word、图片等附件不要（那是通知的附件，不是赛事官网）。
import { urlsInText } from './known-event-mentions.mjs';
import { leadRank } from './trace-drafts.mjs';

// 服务器上是 ./crawler/lib/，仓库里是 ../crawler/lib/（同 same-name-supplement.mjs 的做法）
const { extractText } = await import('./crawler/lib/extract.mjs').catch(() => import('../crawler/lib/extract.mjs'));

const LINK_HINT = /官网|官方网站|报名|注册|参赛|大赛|竞赛|挑战赛|组委会|章程|网址/;
const FILE_LINK = /\.(?:pdf|docx?|xlsx?|pptx?|zip|rar|7z|jpe?g|png|gif)(?:$|[?#])/i;
const MAX_LINKS = 5;

const hostOf = url => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } };
// 学校、单位网站常常一个子域名一个部门（jwc.xx.edu.cn、cs.xx.edu.cn、jwc.wuit.cn），按主域名比：
// xx.edu.cn / xx.com.cn 这类取后三段，其余取后两段
const siteOf = host => host.split('.').slice(/\.(?:edu|com|org|gov|net|ac)\.cn$/.test(host) ? -3 : -2).join('.');
const sameSite = (a, b) => Boolean(a && b) && siteOf(a) === siteOf(b);

export function linksFromNoticePage(html, pageUrl, { limit = MAX_LINKS } = {}) {
  const pageHost = hostOf(pageUrl);
  const keep = url => /^https?:\/\//i.test(url) && !FILE_LINK.test(url) && leadRank(url) < 9 && !sameSite(hostOf(url), pageHost);
  const out = [];
  const seen = new Set();
  const push = (url, label, from) => {
    const clean = String(url || '').replace(/[)）\]】>》,，。;；]+$/, '');
    if (!keep(clean) || seen.has(clean)) return;
    seen.add(clean);
    out.push({ url:clean, label:String(label || '').replace(/\s+/g, ' ').trim().slice(0, 80), from });
  };
  // 正文里直接写出的网址最可靠，排前面
  for (const url of urlsInText(extractText(html, { maxChars:30000 }), pageUrl)) push(url, '', 'text');
  // 链接：<a href="…">文字</a>（不引 cheerio：这个脚本在仓库里和服务器上的依赖目录不同，用正则足够）
  const ANCHOR = /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html || '').matchAll(ANCHOR)) {
    const raw = match[1].replace(/&amp;/g, '&');
    const label = match[2].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    if (/^(?:#|javascript:|mailto:|tel:)/i.test(raw)) continue;
    let url;
    try { url = new URL(raw, pageUrl).href; } catch { continue; }
    if (LINK_HINT.test(`${label} ${url}`)) push(url, label, 'anchor');
  }
  return out.slice(0, limit);
}
