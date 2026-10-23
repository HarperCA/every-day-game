// 读完详情页、关键信息还缺时的两步补读（2026-10-02，用户定）：
//
//   ① 按公告标题找正式通知：官网首页常常只有介绍和一串公告标题（“关于举办2026年××大赛的通知”），
//      参赛对象、报名时间写在那份通知里。拿标题去搜，只认和这个页面同一个网站的结果，读通知正文，
//      和首页合在一起重新抽取。通知正文是文字，抽出的每一项都能回原文逐字核对——优先用它。
//   ② 识别页面上的图片：①之后还缺的，把页面里的大图（报名卡片、日程图）交给 DeepSeek 识别文字再抽取。
//      识别出来的文字没法像正文那样逐字核对原网页，所以凡是靠图片补出来的项，都标明“来自官网图片（文字识别）”，
//      整条记录进人工审核，不自动发布、不自动归档（ingest-candidates.mjs）。
//
// 实测（2026-10-02，全国数字建筑创新应用大赛官网）：首页的“本科组 适用本科院校”和“大赛日程”都是图片，
// 读网页文字的程序看不到；DeepSeek 识别两张图逐字正确，每张约 2 秒。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { coreMatches } from './resolve-notice-leads.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MIN_IMAGE_BYTES = 15 * 1024;          // 太小的多半是图标、按钮
const MAX_IMAGES = 5;
const SKIP_IMAGE = /logo|icon|qrcode|qr_code|erweima|ewm|avatar|weixin|wechat|wx_|favicon|sprite|loading|arrow|button|btn/i;
const IMAGE_EXT = /\.(?:png|jpe?g|webp|bmp)(?:$|[?#])/i;

const squash = value => String(value || '').normalize('NFKC').replace(/[\s“”"'‘’「」『』《》【】()（）]/g, '');

// ---- 还缺什么 ----
// 参赛对象和资格都没有：缺“参赛对象”；报名截止没有：缺“报名时间”
export function missingKeyFields(extracted = {}) {
  const missing = [];
  if (!extracted?.participants && !extracted?.eligibility) missing.push('参赛对象');
  if (!extracted?.registration_end) missing.push('报名时间');
  return missing;
}

// ---- ① 按公告标题找正式通知 ----
// 从页面文字里找“关于……的通知/公告”这类标题，只要和这场比赛有关的（赛事名大部分字对得上），
// 举办通知、带今明年份的排前面；最多 2 个
export function findNoticeTitles(text, contestName, { year = new Date().getFullYear() } = {}) {
  const core = squash(contestName).replace(/^(?:\d{4}年?|第[一二三四五六七八九十百\d]+届)/, '');
  const found = new Set();
  for (const line of String(text || '').split(/\n+/)) {
    const cleaned = line.replace(/\s*\d{4}-\d{2}-\d{2}\s*$/, '').replace(/^[\s#*\-·•\d.、]+/, '').trim();
    if (cleaned.length < 8 || cleaned.length > 80) continue;
    if (!/^关于.{4,70}(?:通知|公告)$/.test(cleaned) && !/^.{4,60}(?:大赛|竞赛|比赛|挑战赛).{0,20}(?:通知|公告)$/.test(cleaned)) continue;
    if (core && !coreMatches(cleaned, core)) continue;
    found.add(cleaned);
  }
  const score = title => (/举办|开展|组织参加|报名/.test(title) ? 2 : 0) + (new RegExp(`${year}|${year + 1}`).test(title) ? 1 : 0)
    - (/获奖|名单|公示|结果|培训|训练营|测试|账号|直播|权限/.test(title) ? 3 : 0);
  return [...found].sort((a, b) => score(b) - score(a)).filter(title => score(title) > 0).slice(0, 2);
}

// 学校、单位网站常常一个子域名一个部门：按主域名比（同 notice-page-links.mjs）
const hostOf = url => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } };
const siteOf = host => host.split('.').slice(/\.(?:edu|com|org|gov|net|ac)\.cn$/.test(host) ? -3 : -2).join('.');
export const sameSite = (a, b) => Boolean(hostOf(a) && hostOf(b)) && siteOf(hostOf(a)) === siteOf(hostOf(b));

// 首页（/、/home、/index.html 这类）不是通知：实测百度对“关于举办……的通知”返回的同站结果就是首页本身（2026-10-03）
const isHomePage = url => { try { return /^\/(?:(?:home|index|default)(?:\.\w+)?)?\/?$/i.test(new URL(url).pathname); } catch { return true; } };

// 搜索结果里挑官方那一份：必须和正在读的官网是同一个网站（学校转发的不算，按“只认官方原文”），不是首页，标题和公告标题大部分字对得上
export function pickOfficialNotice(references, pageUrl, title) {
  return (references || []).find(item => sameSite(item.url, pageUrl) && !isHomePage(item.url)
    && item.url.replace(/\/$/, '') !== String(pageUrl).replace(/\/$/, '')
    && coreMatches(`${item.title} ${item.content || ''}`, title, 0.6)) || null;
}

// ---- ② 识别页面上的图片 ----
// 页面原始 HTML 里的 <img>，加上 Kimi 读网页时转存的图片地址；去掉图标、二维码、头像等，去重，最多 5 张
export function imageCandidates({ html = '', pageUrl = '', renderedImages = [] } = {}) {
  const urls = [];
  for (const match of String(html || '').matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    try { urls.push(new URL(match[1].replace(/&amp;/g, '&'), pageUrl).href); } catch { /* 坏地址 */ }
  }
  urls.push(...renderedImages);
  const seen = new Set();
  return urls.filter(url => /^https?:\/\//i.test(url) && !SKIP_IMAGE.test(url) && (IMAGE_EXT.test(url) || /kimi-web-img/.test(url)))
    .filter(url => (seen.has(url) ? false : (seen.add(url), true)))
    .slice(0, MAX_IMAGES * 2); // 下载后还会按大小再筛一次
}

// ---- 赛事海报（2026-10，小程序首页瀑布流卡片用）----
// 只认官网自己在 <head> 里声明的封面图（og:image、twitter:image、image_src），不从正文 <img> 里猜：
// 正文大图多半是广告横幅、日程图，猜错了比没有更糟，没有时小程序显示统一占位图。
// 只收 https：小程序真机加载 http 图片常常失败。
const POSTER_KEYS = ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src', 'image'];

const attrOf = (tag, name) => {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3] ?? '').trim() : '';
};

export function pickPosterImage({ html = '', pageUrl = '' } = {}) {
  const head = String(html || '').slice(0, 200000);
  const found = new Map();
  for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attrOf(tag, 'property') || attrOf(tag, 'name') || attrOf(tag, 'itemprop')).toLowerCase();
    const content = attrOf(tag, 'content');
    if (POSTER_KEYS.includes(key) && content && !found.has(key)) found.set(key, content);
  }
  for (const [tag] of head.matchAll(/<link\b[^>]*>/gi)) {
    if (/\bimage_src\b/i.test(attrOf(tag, 'rel')) && attrOf(tag, 'href') && !found.has('image_src')) found.set('image_src', attrOf(tag, 'href'));
  }
  for (const key of [...POSTER_KEYS, 'image_src']) {
    const raw = found.get(key);
    if (!raw) continue;
    let url = '';
    try { url = new URL(raw.replace(/&amp;/g, '&'), pageUrl).href; } catch { continue; }
    if (/^https:\/\//i.test(url) && !SKIP_IMAGE.test(url) && url.length <= 500) return url;
  }
  return '';
}

// ---- 没有声明封面图时：官网页面上和赛事有关的大图（2026-10，用户定）----
// 只要“看着像赛事主视觉”的：文件名、alt、class 里带海报/横幅/主视觉/赛事字样，或 alt 写着赛事名；
// 再真的下载图片头部量尺寸：横版、够大才收（宽 ≥ 600，宽高比 1.2～4），挡掉图标、二维码、竖条广告。
const POSTER_HINT = /poster|banner|haibao|kv\b|key-?visual|cover|海报|横幅|主视觉|主题|大赛|竞赛|比赛|挑战赛|contest|competition/i;
const MIN_POSTER_WIDTH = 600;
const MIN_POSTER_BYTES = 20 * 1024;

export function pageImageCandidates({ html = '', pageUrl = '', contestName = '' } = {}) {
  const core = squash(contestName).replace(/^(?:\d{4}年?|第[一二三四五六七八九十百\d]+届)/, '').slice(0, 12);
  const found = [];
  const push = (raw, context, declared = {}) => {
    if (!raw || /^data:/i.test(raw)) return;
    let url = '';
    try { url = new URL(raw.replace(/&amp;/g, '&'), pageUrl).href; } catch { return; }
    if (!/^https:\/\//i.test(url) || SKIP_IMAGE.test(url) || /\.(?:svg|gif)(?:$|[?#])/i.test(url) || url.length > 500) return;
    if ((declared.width && declared.width < 300) || (declared.height && declared.height < 120)) return;
    let score = 0;
    // 只看路径不看域名：赛事官网域名里常带 contest、dasai，按域名算每张图都会被当成赛事图
    let pathname = new URL(url).pathname;
    try { pathname = decodeURIComponent(pathname); } catch { /* 坏的百分号编码就按原样比 */ }
    if (POSTER_HINT.test(`${pathname} ${context}`)) score += 2;
    if (core.length >= 4 && squash(context).includes(core.slice(0, 6))) score += 3;
    if (declared.width >= MIN_POSTER_WIDTH) score += 1;
    if (score > 0 && !found.some(item => item.url === url)) found.push({ url, score, order:found.length });
  };
  const body = String(html || '').slice(0, 400000);
  for (const [tag] of body.matchAll(/<img\b[^>]*>/gi)) {
    const raw = attrOf(tag, 'data-original') || attrOf(tag, 'data-src') || attrOf(tag, 'src');
    push(raw, `${attrOf(tag, 'alt')} ${attrOf(tag, 'title')} ${attrOf(tag, 'class')}`,
      { width:Number(attrOf(tag, 'width')) || 0, height:Number(attrOf(tag, 'height')) || 0 });
  }
  // 横幅常写成背景图：<div class="banner" style="background-image:url(...)">
  for (const [tag] of body.matchAll(/<[a-z]+\b[^>]*style\s*=\s*["'][^"']*background(?:-image)?\s*:[^"']*url\([^)]*\)[^>]*>/gi)) {
    const raw = /url\(\s*["']?([^"')]+)["']?\s*\)/i.exec(tag)?.[1];
    push(raw, `${attrOf(tag, 'class')} ${attrOf(tag, 'id')}`);
  }
  return found.sort((a, b) => b.score - a.score || a.order - b.order).slice(0, 6);
}

// 从图片文件头读宽高：PNG、JPEG、WebP；读不出返回 null
export function imageSize(buffer) {
  const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return { width:b.readUInt32BE(16), height:b.readUInt32BE(20), type:'png' };
  if (b.length >= 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    const kind = b.toString('latin1', 12, 16);
    if (kind === 'VP8X') return { width:1 + b.readUIntLE(24, 3), height:1 + b.readUIntLE(27, 3), type:'webp' };
    if (kind === 'VP8 ') return { width:b.readUInt16LE(26) & 0x3fff, height:b.readUInt16LE(28) & 0x3fff, type:'webp' };
    if (kind === 'VP8L') { const bits = b.readUInt32LE(21); return { width:1 + (bits & 0x3fff), height:1 + ((bits >> 14) & 0x3fff), type:'webp' }; }
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < b.length) {
      if (b[offset] !== 0xff) { offset += 1; continue; }
      const marker = b[offset + 1];
      const length = b.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width:b.readUInt16BE(offset + 7), height:b.readUInt16BE(offset + 5), type:'jpeg' };
      }
      offset += 2 + length;
    }
  }
  return null;
}

export function looksLikePoster(size, bytes) {
  if (!size || !size.width || !size.height) return false;
  const ratio = size.width / size.height;
  return size.width >= MIN_POSTER_WIDTH && ratio >= 1.2 && ratio <= 4 && (!bytes || bytes >= MIN_POSTER_BYTES);
}

// 下载图片前 64KB 量尺寸；像海报返回尺寸，否则（下载失败、不是图片、太小、方图、细长条）返回 null
export async function measurePoster(url, pageUrl, { fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  try {
    const res = await fetchImpl(url, { headers:{ range:'bytes=0-65535', referer:pageUrl }, signal:AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (type && !/^image\/(?:png|jpe?g|webp)/.test(type)) return null;
    const total = Number(/\/(\d+)$/.exec(res.headers.get('content-range') || '')?.[1] || res.headers.get('content-length') || 0);
    const size = imageSize(Buffer.from(await res.arrayBuffer()));
    return looksLikePoster(size, total) ? { width:size.width, height:size.height } : null;
  } catch { return null; }
}

// 依次量候选图片，第一张像海报的就用；都不像返回 null
export async function findPagePoster({ html = '', pageUrl = '', contestName = '' } = {}, options = {}) {
  for (const candidate of pageImageCandidates({ html, pageUrl, contestName })) {
    const size = await measurePoster(candidate.url, pageUrl, options);
    if (size) return { url:candidate.url, ...size };
  }
  return null;
}

// 一个官网页面找海报：先用页面声明的封面图，没有再找页面上的赛事大图。source 记来源，后台可据此复核。
// 声明的封面图也要量尺寸：实测不少平台给所有页面声明同一张方形 logo（天池 640×640），或者写了个打不开的地址
export async function findPoster({ html = '', pageUrl = '', contestName = '' } = {}, options = {}) {
  const declared = pickPosterImage({ html, pageUrl });
  if (declared && await measurePoster(declared, pageUrl, options)) return { url:declared, source:'declared' };
  const page = await findPagePoster({ html, pageUrl, contestName }, options);
  return page ? { url:page.url, source:'page_image' } : null;
}

const readKey = file => { try { return fs.readFileSync(path.join(HERE, file), 'utf8').trim(); } catch { return ''; } };
const OCR_PROMPT = '逐字识别这张图片里的所有文字，按从上到下、从左到右的顺序原样输出，不要解释、不要补充图片里没有的字。图片里没有文字就只回复“无文字”。';

// 下载图片并交给 DeepSeek 识别文字；太小（图标）或太大的跳过，返回 null
export async function ocrImage(url, { key = readKey('.extract-key'), fetchImpl = globalThis.fetch, model = 'deepseek-flash' } = {}) {
  if (!key) throw new Error('deepseek_key_not_configured');
  const res = await fetchImpl(url, { signal:AbortSignal.timeout(30000) });
  if (!res.ok) return null;
  const type = (res.headers.get('content-type') || '').split(';')[0] || 'image/png';
  if (!/^image\//.test(type) || /svg|gif/.test(type)) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < MIN_IMAGE_BYTES || buffer.length > MAX_IMAGE_BYTES) return null;
  const response = await fetchImpl('https://api.deepseek.com/chat/completions', {
    method:'POST', headers:{ 'content-type':'application/json', authorization:`Bearer ${key}` },
    body:JSON.stringify({ model, max_tokens:2000, messages:[{ role:'user', content:[
      { type:'text', text:OCR_PROMPT }, { type:'image_url', image_url:{ url:`data:${type};base64,${buffer.toString('base64')}` } },
    ] }] }),
    signal:AbortSignal.timeout(90000),
  });
  if (!response.ok) throw new Error(`ocr_http_${response.status}`);
  const text = String((await response.json())?.choices?.[0]?.message?.content || '').trim();
  return !text || /^无文字/.test(text) ? '' : text.slice(0, 600);
}

// 识别出的文字和“参赛对象、报名时间”有多相关：组别、院校、学生、报名、日期多的排前面；福利、折扣、扫码这类广告往后放
export function ocrRelevance(text) {
  const value = String(text || '');
  const hits = (value.match(/组|院校|学生|本科|高职|专科|研究生|对象|资格|报名|截止|日程|赛程|\d{1,2}月|\d{1,2}日/g) || []).length;
  const ads = (value.match(/福利|折扣|优惠|课程卡|扫码|领取|价值|¥|￥|会员|下载/g) || []).length;
  return hits - ads * 2;
}

// 抽取结果里哪些项的原文摘录只出现在图片识别的文字里（网页正文里没有）：这些项的依据来自图片
export function fieldsFromImages(extracted = {}, pageText = '', ocrText = '') {
  const page = squash(pageText);
  const ocr = squash(ocrText);
  if (!ocr) return [];
  const fields = [];
  for (const [field, value] of Object.entries(extracted || {})) {
    const items = Array.isArray(value) ? value : value && typeof value === 'object' && 'quote' in value ? [value] : [];
    for (const item of items) {
      const quote = squash(item?.quote);
      if (quote && !page.includes(quote) && ocr.includes(quote.slice(0, Math.min(quote.length, 12)))) { fields.push(field); break; }
    }
  }
  return fields;
}

// 抽到的关键项比原来多，才算补读有用
export const keyFieldCount = extracted => ['participants', 'eligibility', 'registration_start', 'registration_end', 'format_and_rules', 'organizer', 'fees', 'team_size']
  .filter(field => extracted?.[field]).length;
