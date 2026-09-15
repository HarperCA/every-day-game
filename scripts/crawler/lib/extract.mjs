// 正文提取与链接发现。
//
// 实测背景：登记的来源多是官网首页，直接剥标签得到的大半是导航菜单
// （cy.ncss.cn 首页 3023 字符里绝大部分是「首页 登录 注册 通知公告」）。
// 真正有价值的是「通知详情页」——教育部通知详情页 5714 字符全是正文，
// AI 能据此核出「9月25日12时」「年龄不超过35岁」这类细节。
// 所以这里既要去噪，也要能发现通往详情页的链接。
import * as cheerio from 'cheerio';

const DROP_SELECTORS = 'script, style, noscript, nav, header, footer, aside, iframe, svg, form, .nav, .menu, .header, .footer, .sidebar, .breadcrumb';
const MAIN_SELECTORS = ['article', 'main', '[role="main"]', '.article', '.content', '.detail', '.article-content', '.news-content', '#content', '#article'];

// 通知类页面的标题特征
const NOTICE_KEYWORDS = /通知|公告|章程|规程|方案|办法|细则|报名|竞赛|大赛|简章|须知|indexNotice/i;
const NOISE_ANCHORS = /^(首页|登录|注册|返回|更多|下一页|上一页|English|设为首页|加入收藏)$/;

export function normalizeWhitespace(text) {
  return String(text || '').replace(/[\t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/[ ]{2,}/g, ' ').trim();
}

// 优先取正文容器；找不到就退回 body，但仍然去掉导航类元素。
export function extractText(html, { maxChars = 20000 } = {}) {
  if (!html) return '';
  const $ = cheerio.load(html);
  $(DROP_SELECTORS).remove();
  let node = null;
  let best = 0;
  for (const selector of MAIN_SELECTORS) {
    $(selector).each((_, element) => {
      const length = $(element).text().replace(/\s+/g, '').length;
      if (length > best) { best = length; node = $(element); }
    });
  }
  // 正文容器太短说明选错了，不如用整页
  const source = node && best > 200 ? node : $('body');
  return normalizeWhitespace(source.text()).slice(0, maxChars);
}

export function extractTitle(html) {
  if (!html) return '';
  const $ = cheerio.load(html);
  const h1 = $('h1').first().text().trim();
  return normalizeWhitespace(h1 || $('title').first().text().trim()).slice(0, 200);
}

// 返回同站的候选通知链接，按「像不像通知页」排序。
export function findNoticeLinks(html, baseUrl, { limit = 12 } = {}) {
  if (!html) return [];
  const $ = cheerio.load(html);
  let base;
  try { base = new URL(baseUrl); } catch { return []; }
  const seen = new Map();
  $('a[href]').each((_, element) => {
    const raw = $(element).attr('href');
    if (!raw || /^(javascript:|mailto:|tel:|#)/i.test(raw)) return;
    let absolute;
    try { absolute = new URL(raw, baseUrl); } catch { return; }
    if (!/^https?:$/.test(absolute.protocol)) return;
    // 只跟进同站或同主域，避免爬到无关站点
    const sameSite = absolute.hostname === base.hostname
      || absolute.hostname.endsWith(`.${base.hostname.split('.').slice(-2).join('.')}`);
    if (!sameSite) return;
    const text = normalizeWhitespace($(element).text()).slice(0, 120);
    if (!text || NOISE_ANCHORS.test(text)) return;
    const href = absolute.href.split('#')[0];
    if (seen.has(href)) return;
    const isPdf = /\.pdf(\?|$)/i.test(href);
    // 详情页通常带日期或数字 id，纯栏目页一般没有
    const looksLikeDetail = /\/\d{4,}|\/t\d{8}|\d{5,}\.(html?|shtml)/i.test(href);
    let score = 0;
    if (NOTICE_KEYWORDS.test(text)) score += 5;
    if (NOTICE_KEYWORDS.test(href)) score += 2;
    if (looksLikeDetail) score += 3;
    if (isPdf) score += 4;
    if (text.length >= 8) score += 1;
    if (score <= 0) return;
    seen.set(href, { url: href, text, score, isPdf });
  });
  return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

// 图标、logo、间隔图之类没有信息量，抓了只会浪费 AI 的视觉配额。
const NOISE_IMAGE = /(logo|icon|favicon|spacer|blank|pixel|avatar|qrcode|erweima|share|weixin|weibo|btn_|bg[_.]|banner_ad)/i;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp)(\?|$)/i;

// 国内赛事通知常把报名流程、赛程表整张做成图片，纯文本抓取会漏掉，
// 而 AI 审核本身支持多模态输入，所以这些图值得单独收集。
export function findImages(html, baseUrl, { limit = 8 } = {}) {
  if (!html) return [];
  const $ = cheerio.load(html);
  $('nav, header, footer, aside, .nav, .menu, .header, .footer').remove();
  const seen = new Map();
  $('img').each((_, element) => {
    const raw = $(element).attr('src') || $(element).attr('data-src') || $(element).attr('data-original');
    if (!raw || /^data:/i.test(raw)) return;
    let absolute;
    try { absolute = new URL(raw, baseUrl); } catch { return; }
    if (!/^https?:$/.test(absolute.protocol)) return;
    const href = absolute.href;
    if (seen.has(href) || NOISE_IMAGE.test(href)) return;
    const alt = normalizeWhitespace($(element).attr('alt') || '').slice(0, 120);
    // 站点常用 width/height 属性标注，尺寸太小的基本是图标
    const width = Number.parseInt($(element).attr('width') || '0', 10);
    const height = Number.parseInt($(element).attr('height') || '0', 10);
    if ((width && width < 200) || (height && height < 120)) return;
    let score = 0;
    if (IMAGE_EXT.test(href)) score += 2;
    if (NOTICE_KEYWORDS.test(alt)) score += 4;
    if (width >= 600 || height >= 400) score += 3;
    if (alt.length >= 4) score += 1;
    seen.set(href, { url: href, alt, width: width || null, height: height || null, score });
  });
  return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

// PDF 文本抽取。pdf-parse 是可选依赖：装不上也不该让整个爬虫失败。
// 注意必须引内部实现而不是包入口：pdf-parse 1.1.1 的 index.js 里残留了一段调试代码，
// 导入时会去读 ./test/data/05-versions-space.pdf，在正常安装下必定 ENOENT。
export async function extractPdfText(buffer, { maxChars = 20000 } = {}) {
  if (!buffer || !buffer.length) return { text: '', status: 'empty' };
  try {
    const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
    const parsed = await pdfParse(buffer);
    return { text: normalizeWhitespace(parsed.text).slice(0, maxChars), status: 'ok', pages: parsed.numpages };
  } catch (error) {
    return { text: '', status: 'pdf_parse_failed', error: String(error?.message || error).slice(0, 200) };
  }
}
