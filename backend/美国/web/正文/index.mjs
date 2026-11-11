// 正文：从网页里取出标题、正文和链接。只提供函数，由 读网页 调用。
// 搬自 crawler/lib/extract.mjs 的 extractText、extractTitle、findNoticeLinks（去噪的规则不变）。
// 背景（旧注释）：登记的来源多是官网首页，直接剥标签得到的大半是导航菜单；真正有价值的是通知详情页，所以既要去噪，也要找出通往详情页的链接。
//
//   取网页(html, 网址) → { 标题, 正文, 链接们: [{ url, text, kind }] }
//   链接只要同站（含同一主域的子站）的；kind 分 通知 / 附件 / 报名入口 / 其他，按这个顺序排，同类里像通知页的在前，最多 30 个
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../Environment/package.json', import.meta.url));
const cheerio = require('cheerio');

export const LINK_KINDS = ['通知', '附件', '报名入口', '其他'];
const 最多链接 = 30;
const 去掉 = 'script, style, noscript, nav, header, footer, aside, iframe, svg, form, .nav, .menu, .header, .footer, .sidebar, .breadcrumb';
const 正文容器 = ['article', 'main', '[role="main"]', '.article', '.content', '.detail', '.article-content', '.news-content', '#content', '#article'];
const 通知词 = /通知|公告|章程|规程|方案|办法|细则|简章|须知/;
const 比赛词 = /竞赛|大赛|indexNotice/i;
const 报名词 = /报名|注册|signup|register/i;
const 附件 = /\.(pdf|docx?|xlsx?|zip|rar)(\?|$)/i;
const 噪声链接 = /^(首页|登录|注册|返回|更多|下一页|上一页|English|设为首页|加入收藏)$/;
const 像详情页 = /\/\d{4,}|\/t\d{8}|\d{5,}\.(html?|shtml)/i;   // 详情页通常带日期或数字编号，栏目页一般没有

export const 整理空白 = text => String(text || '').replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// 网页代码压成一行时（很多官网是这样），直接取文字段落会并成一整行：行首的“主办单位：”认不出来，原文核对按整行取依据也会取得太长。
// 所以取文字前在块的末尾补换行、表格格子之间补空格（块和旧代码 competitionExtract.js 的 toStructuredText 一样，2026-11-02）。
const 换行的块 = 'p, div, li, tr, h1, h2, h3, h4, h5, h6, section, article';

function 取正文($) {
  $(去掉).remove();
  $('br').replaceWith('\n');
  $(换行的块).append('\n');
  $('td, th').append(' ');
  let node = null;
  let best = 0;
  for (const selector of 正文容器) {
    $(selector).each((_, el) => {
      const length = $(el).text().replace(/\s+/g, '').length;
      if (length > best) { best = length; node = $(el); }
    });
  }
  // 正文容器太短说明选错了，不如用整页
  return 整理空白((node && best > 200 ? node : $('body')).text());
}

function 取链接($, 网址) {
  let base;
  try { base = new URL(网址); } catch { return []; }
  const 主域 = base.hostname.split('.').slice(-2).join('.');
  const seen = new Map();
  $('a[href]').each((_, el) => {
    const raw = $(el).attr('href');
    if (!raw || /^(javascript:|mailto:|tel:|#)/i.test(raw)) return;
    let abs;
    try { abs = new URL(raw, base); } catch { return; }
    if (!/^https?:$/.test(abs.protocol)) return;
    if (abs.hostname !== base.hostname && !abs.hostname.endsWith(`.${主域}`)) return;   // 只跟同站或同主域，避免爬到无关网站
    const text = 整理空白($(el).text()).slice(0, 120);
    if (!text || 噪声链接.test(text)) return;
    abs.hash = '';
    const url = abs.href;
    if (seen.has(url)) return;
    const kind = 附件.test(url) ? '附件' : 通知词.test(text) ? '通知' : 报名词.test(text) || 报名词.test(url) ? '报名入口'
      : 比赛词.test(text) || 像详情页.test(url) ? '通知' : '其他';
    const score = (通知词.test(text) || 比赛词.test(text) ? 5 : 0) + (像详情页.test(url) ? 3 : 0) + (text.length >= 8 ? 1 : 0);
    seen.set(url, { url, text, kind, score });
  });
  return [...seen.values()]
    .sort((a, b) => LINK_KINDS.indexOf(a.kind) - LINK_KINDS.indexOf(b.kind) || b.score - a.score)
    .slice(0, 最多链接)
    .map(({ url, text, kind }) => ({ url, text, kind }));
}

export function 取网页(html, 网址) {
  if (!html) return { 标题: '', 正文: '', 链接们: [] };
  const $ = cheerio.load(html);
  const 标题 = 整理空白($('h1').first().text().trim() || $('title').first().text().trim()).slice(0, 200);
  const 链接们 = 取链接($, 网址);   // 先取链接：取正文时会把导航删掉
  return { 标题, 正文: 取正文($), 链接们 };
}
