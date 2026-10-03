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
