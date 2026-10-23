// 赛事海报（2026-10，首页双列卡片）：抓取取官网封面图 → 草稿 → 公开缓存 → 列表接口 → 小程序卡片
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { findPagePoster, findPoster, imageSize, looksLikePoster, pageImageCandidates, pickPosterImage } from '../scripts/server/page-supplement.mjs';
import { applyPosters, pagesOf, parseArgs } from '../scripts/server/backfill-posters.mjs';
import { hydratePublic } from '../apps/miniprogram/services/publicRecord';
import { coverOf, withCover } from '../apps/miniprogram/services/cardCover';

const require = createRequire(import.meta.url);
const { candidateToRecord } = require('../apps/miniprogram/cloudfunctions/adminData/candidateToRecord.js');
const { toPublicCache } = require('../apps/miniprogram/cloudfunctions/adminData/publicCache.js');
const { LIST_FIELDS, toListItem } = require('../apps/miniprogram/cloudfunctions/publicData/listFields.js');

const PAGE = 'https://www.example-contest.cn/2026/index.html';

describe('从官网 <head> 取封面图', () => {
  it('og:image 优先，属性顺序不限，相对地址按页面补全', () => {
    const html = `<head><meta content="/upload/cover-2026.jpg" property="og:image"><meta name="twitter:image" content="https://cdn.example.com/tw.jpg"></head>`;
    expect(pickPosterImage({ html, pageUrl:PAGE })).toBe('https://www.example-contest.cn/upload/cover-2026.jpg');
  });
  it('没有 og:image 时依次用 twitter:image、image_src', () => {
    expect(pickPosterImage({ html:`<meta name='twitter:image' content='https://cdn.example.com/tw.jpg'>`, pageUrl:PAGE })).toBe('https://cdn.example.com/tw.jpg');
    expect(pickPosterImage({ html:`<link rel="image_src" href="https://cdn.example.com/src.png">`, pageUrl:PAGE })).toBe('https://cdn.example.com/src.png');
  });
  it('http 地址、logo 和二维码不要，换下一个候选；都不合格就留空', () => {
    const html = `<meta property="og:image" content="https://www.example-contest.cn/images/logo.png">
      <meta name="twitter:image" content="http://www.example-contest.cn/banner.jpg">
      <link rel="image_src" href="https://www.example-contest.cn/poster.jpg">`;
    expect(pickPosterImage({ html, pageUrl:PAGE })).toBe('https://www.example-contest.cn/poster.jpg');
    expect(pickPosterImage({ html:'<meta property="og:image" content="https://x.cn/erweima.png">', pageUrl:PAGE })).toBe('');
  });
  it('不从正文 <img> 里猜海报', () => {
    expect(pickPosterImage({ html:'<body><img src="https://www.example-contest.cn/big-banner.jpg"></body>', pageUrl:PAGE })).toBe('');
    expect(pickPosterImage({})).toBe('');
  });
  it('&amp; 还原成 &', () => {
    expect(pickPosterImage({ html:'<meta property="og:image" content="https://cdn.example.com/a.jpg?w=800&amp;h=450">', pageUrl:PAGE })).toBe('https://cdn.example.com/a.jpg?w=800&h=450');
  });
});

// 只有文件头的 PNG：够量尺寸
const pngHead = (width, height) => {
  const b = Buffer.alloc(32);
  b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16); b.writeUInt32BE(height, 20);
  return b;
};
// 最小的 JPEG 文件头：SOI + APP0 + SOF0（高、宽）
const jpegHead = (width, height) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0]);
const imageReply = (buffer, total) => ({ ok:true, headers:new Headers({ 'content-type':'image/png', 'content-range':`bytes 0-${buffer.length - 1}/${total}` }), arrayBuffer:async () => buffer });

describe('官网没声明封面图时，找页面上的赛事大图', () => {
  const html = `<body>
    <img src="/images/logo.png" alt="大赛logo">
    <img src="https://www.example-contest.cn/upload/qrcode-ewm.jpg">
    <img src="/upload/news-1.jpg" alt="新闻配图">
    <img src="/upload/2026kv.jpg" alt="全国大学生测试设计大赛主视觉" width="1200">
    <div class="banner" style="background-image:url('/upload/banner-bg.jpg')"></div>
    <img src="/upload/small-banner.png" width="120" height="40">
  </body>`;
  it('只挑带赛事字样或赛事名的图片，按分数排；logo、二维码、没线索的新闻图、太小的不要', () => {
    const urls = pageImageCandidates({ html, pageUrl:PAGE, contestName:'全国大学生测试设计大赛' }).map(item => item.url);
    expect(urls).toEqual(['https://www.example-contest.cn/upload/2026kv.jpg', 'https://www.example-contest.cn/upload/banner-bg.jpg']);
  });
  it('从文件头读宽高', () => {
    expect(imageSize(pngHead(1200, 500))).toEqual({ width:1200, height:500, type:'png' });
    expect(imageSize(jpegHead(1920, 800))).toEqual({ width:1920, height:800, type:'jpeg' });
    expect(imageSize(Buffer.from('not an image'))).toBeNull();
  });
  it('横版、够大才算海报', () => {
    expect(looksLikePoster({ width:1200, height:500 }, 200000)).toBe(true);
    expect(looksLikePoster({ width:400, height:200 }, 200000)).toBe(false);   // 太小
    expect(looksLikePoster({ width:800, height:800 }, 200000)).toBe(false);   // 方图（多半是二维码、头像）
    expect(looksLikePoster({ width:1600, height:200 }, 200000)).toBe(false);  // 细长条
    expect(looksLikePoster({ width:1200, height:500 }, 5000)).toBe(false);    // 文件太小
  });
  it('依次下载量尺寸，第一张像海报的就用', async () => {
    const fetchImpl = async url => url.endsWith('2026kv.jpg') ? imageReply(pngHead(700, 700), 90000) : imageReply(pngHead(1500, 600), 300000);
    expect(await findPagePoster({ html, pageUrl:PAGE, contestName:'全国大学生测试设计大赛' }, { fetchImpl }))
      .toEqual({ url:'https://www.example-contest.cn/upload/banner-bg.jpg', width:1500, height:600 });
    expect(await findPagePoster({ html, pageUrl:PAGE }, { fetchImpl:async () => imageReply(pngHead(300, 300), 9000) })).toBeNull();
  });
  it('findPoster：有声明的封面图就不再找页面大图，并记下来源', async () => {
    const fetchImpl = async () => imageReply(pngHead(1500, 600), 300000);
    expect(await findPoster({ html:`<meta property="og:image" content="https://cdn.example.com/og.jpg">${html}`, pageUrl:PAGE }, { fetchImpl })).toEqual({ url:'https://cdn.example.com/og.jpg', source:'declared' });
    expect(await findPoster({ html, pageUrl:PAGE, contestName:'全国大学生测试设计大赛' }, { fetchImpl })).toEqual({ url:'https://www.example-contest.cn/upload/2026kv.jpg', source:'page_image' });
    expect(await findPoster({ html:'<p>没有图</p>', pageUrl:PAGE }, { fetchImpl })).toBeNull();
  });
  it('声明的封面图也量尺寸：方形 logo、打不开的地址不算，改找页面大图', async () => {
    const withOg = `<meta property="og:image" content="https://img.alicdn.com/logo-640-640.png">${html}`;
    const fetchImpl = async url => url.includes('alicdn') ? imageReply(pngHead(640, 640), 50000) : imageReply(pngHead(1500, 600), 300000);
    expect(await findPoster({ html:withOg, pageUrl:PAGE, contestName:'全国大学生测试设计大赛' }, { fetchImpl })).toEqual({ url:'https://www.example-contest.cn/upload/2026kv.jpg', source:'page_image' });
    const broken = async url => url.includes('alicdn') ? { ok:false, status:404, headers:new Headers() } : imageReply(pngHead(1500, 600), 300000);
    expect((await findPoster({ html:withOg, pageUrl:PAGE, contestName:'全国大学生测试设计大赛' }, { fetchImpl:broken })).source).toBe('page_image');
  });
});

describe('给已有赛事补海报', () => {
  it('读报名网址和官方来源页，去重，最多 3 个；后台和公开缓存的字段名都认', () => {
    expect(pagesOf({ registrationUrl:'https://a.cn/', sources:[{ url:'https://a.cn/' }, { url:'https://b.cn/notice', is_official:true }, { url:'https://news.cn/x', is_official:false, source_type:'media' }, { url:'https://c.cn/', is_official:true }, { url:'https://d.cn/', is_official:true }] }))
      .toEqual(['https://a.cn/', 'https://b.cn/notice', 'https://c.cn/']);
    expect(pagesOf({ registration_url:'https://e.cn/', sources:[] })).toEqual(['https://e.cn/']);
    expect(pagesOf({ registrationUrl:'暂无' })).toEqual([]);
  });
  it('只写给仍然没有海报的记录，人工填过的不覆盖', () => {
    const records = [{ id:'a', name:'甲' }, { id:'b', name:'乙', posterUrl:'https://manual.cn/p.jpg' }, { id:'c', name:'丙' }];
    const found = [{ id:'a', posterUrl:'https://x.cn/a.jpg', posterSource:'declared', page:'https://x.cn/' }, { id:'b', posterUrl:'https://x.cn/b.jpg', posterSource:'page_image' }];
    const { records:next, changed } = applyPosters(records, found);
    expect(next[0]).toMatchObject({ posterUrl:'https://x.cn/a.jpg', posterSource:'declared' });
    expect(next[1].posterUrl).toBe('https://manual.cn/p.jpg');
    expect(next[2]).toBe(records[2]);
    expect(changed.map(item => item.id)).toEqual(['a']);
  });
  it('只读公开接口的预览模式不能写库', () => {
    expect(() => parseArgs(['--public', 'https://x.cn', '--apply'])).toThrow();
    expect(parseArgs(['--limit', '20', '--apply'])).toMatchObject({ apply:true, limit:20, publicOrigin:'' });
  });
});

describe('海报一路传到小程序', () => {
  const candidate = { name:'全国大学生测试设计大赛', externalId:'poster-1', detailUrl:PAGE };
  it('草稿记下抽取结果里的海报；抽取失败也照用', () => {
    expect(candidateToRecord(candidate, { ok:true, extracted:{}, posterUrl:'https://cdn.example.com/p.jpg' }).posterUrl).toBe('https://cdn.example.com/p.jpg');
    expect(candidateToRecord(candidate, { ok:false, status:'threw', posterUrl:'https://cdn.example.com/p.jpg' }).posterUrl).toBe('https://cdn.example.com/p.jpg');
    expect(candidateToRecord(candidate, null).posterUrl).toBe('');
  });

  const publishable = {
    id:'edition-1', eventId:'event-1', name:'全国大学生计算机设计竞赛', editionName:'全国大学生计算机设计竞赛（2026）', organizer:'测试组委会', eventLevel:'国家级', professions:['计算机与AI'],
    participationFormat:'团队赛', teamSizeCategory:'2～3人', feeType:'免费', registrationOrganization:'自行报名', registrationUrl:'https://example.com/register',
    schedule:{ registration_start:'2026-08-01T00:00:00.000Z', registration_end:'2026-09-30T00:00:00.000Z', status_override:null },
    recommendation:{ recommendation:'值得参加', reasons:['官方资料完整'] }, lastVerifiedAt:'2026-08-30T00:00:00.000Z',
    sources:[{ id:'source-1', source_type:'authority_notice', is_official:true, validity_status:'valid', url:'https://example.com/notice',
      last_verified_at:'2026-08-30T00:00:00Z', title:'全国大学生计算机设计竞赛正式通知', content_summary:'说明当届赛事和报名安排',
      evidence_excerpt:'报名时间为2026年8月1日至9月30日', supports_fields:['赛事名称','届次','报名开始时间'], review_reason:'人工已核对主办方当届通知' }],
    dataStatus:'published', systemValidation:'passed', manualReview:'passed',
  };
  const now = new Date('2026-08-31T00:00:00.000Z');

  it('公开缓存只发 https 海报，其余为空串', () => {
    expect(toPublicCache({ ...publishable, posterUrl:'https://cdn.example.com/p.jpg' }, now).poster_url).toBe('https://cdn.example.com/p.jpg');
    expect(toPublicCache({ ...publishable, posterUrl:'http://cdn.example.com/p.jpg' }, now).poster_url).toBe('');
    expect(toPublicCache(publishable, now).poster_url).toBe('');
  });
  it('列表接口带上 poster_url，小程序读成 posterUrl', () => {
    expect(LIST_FIELDS).toContain('poster_url');
    const listItem = toListItem(toPublicCache({ ...publishable, posterUrl:'https://cdn.example.com/p.jpg' }, now));
    expect(listItem.poster_url).toBe('https://cdn.example.com/p.jpg');
    expect(hydratePublic(listItem).posterUrl).toBe('https://cdn.example.com/p.jpg');
    expect(hydratePublic({}).posterUrl).toBe('');
  });
});

describe('没有海报时的文字封面', () => {
  it('主标题是完整赛事名称，不删字', () => {
    expect(coverOf({ name:'“批改网杯”全国大学生英语翻译大赛', professions:['外语与教育'] })).toEqual({ coverTitle:'“批改网杯”全国大学生英语翻译大赛', coverKicker:'外语与教育', coverTone:'rose' });
    expect(coverOf({ name:'  2026年第八届全国大学生计算机设计竞赛 ' }).coverTitle).toBe('2026年第八届全国大学生计算机设计竞赛');
    expect(coverOf({}).coverTitle).toBe('');
  });
  it('角标是专业大类，颜色按专业大类', () => {
    expect(coverOf({ name:'全国大学生市场调查与分析大赛', professions:['经管与商科'] })).toMatchObject({ coverKicker:'经管与商科', coverTone:'orange' });
    expect(coverOf({ name:'全国大学生统计建模大赛', professions:['数学与统计'] })).toMatchObject({ coverKicker:'数学与统计', coverTone:'indigo' });
    expect(coverOf({ name:'某大赛', professions:['综合/不限专业', '计算机与AI'] })).toMatchObject({ coverKicker:'计算机与AI', coverTone:'blue' });
  });
  it('没有专业大类时按 id 固定取一种颜色，每次一样', () => {
    const first = coverOf({ id:'edition-x', name:'某大赛' });
    expect(first.coverKicker).toBe('大学生竞赛');
    expect(coverOf({ id:'edition-x', name:'某大赛' }).coverTone).toBe(first.coverTone);
    expect(['indigo', 'blue', 'teal', 'purple']).toContain(first.coverTone);
  });
  it('withCover 保留原字段', () => {
    expect(withCover({ id:'a', name:'全国大学生数学建模竞赛', posterUrl:'' })).toMatchObject({ id:'a', posterUrl:'', coverTitle:'全国大学生数学建模竞赛' });
  });
});
