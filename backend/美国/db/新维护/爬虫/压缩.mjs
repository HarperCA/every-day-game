// 压缩网页：交给 AI 写爬虫脚本之前，把源码压成只剩结构的 HTML（2026-11-08 服务器试验的做法：5 个随机官网每个约 0.8–3 万 token）。
// 去掉脚本、样式、图片、表单等；属性只留 id、class、href（href 转成绝对网址）；每段文字截到 40 字；总长最多 3 万字。
//   压缩(html, 网址) → 文字
//   文字量(html) → 页面上能看到的字数（去掉脚本、样式后），判断是不是靠脚本加载的空壳页
import { createRequire } from 'node:module';

const cheerio = createRequire(new URL('../../../../Environment/package.json', import.meta.url))('cheerio');
const 最长 = 30000;
const 每段最长 = 40;
const 去掉 = 'script, style, noscript, svg, img, iframe, link, meta, video, audio, canvas, input, select, option, textarea, br, hr';

export function 压缩(html, 网址) {
  const $ = cheerio.load(html || '');
  $(去掉).remove();
  $('*').each((_, el) => {
    for (const 名 of Object.keys(el.attribs || {})) if (!['id', 'class', 'href'].includes(名)) $(el).removeAttr(名);
    if (el.attribs?.href) { try { $(el).attr('href', new URL(el.attribs.href, 网址).href); } catch { /* 留原样 */ } }
  });
  $('*').contents().each((_, n) => {
    if (n.type === 'comment') { $(n).remove(); return; }
    if (n.type === 'text') { const t = n.data.replace(/\s+/g, ' ').trim(); n.data = t.length > 每段最长 ? `${t.slice(0, 每段最长)}…` : t; }
  });
  const body = ($('body').html() || $.root().html() || '').replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ');
  return body.length > 最长 ? `${body.slice(0, 最长)}…（后面截掉了）` : body;
}

export function 文字量(html) {
  const $ = cheerio.load(html || '');
  $('script, style, noscript, svg').remove();
  return $('body').text().replace(/\s+/g, '').length;
}
