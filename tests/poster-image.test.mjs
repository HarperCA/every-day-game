// 赛事海报（2026-10，首页双列瀑布流）：抓取取官网封面图 → 草稿 → 公开缓存 → 列表接口 → 小程序卡片
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { pickPosterImage } from '../scripts/server/page-supplement.mjs';
import { hydratePublic } from '../apps/miniprogram/services/publicRecord';
import { coverOf, coverTitleOf, estimateCardHeight, splitColumns, withCover } from '../apps/miniprogram/services/waterfall';

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
  it('主标题去掉年份、届次、杯名和“全国大学生”这类通用前缀', () => {
    expect(coverTitleOf('全国大学生市场调查与分析大赛')).toBe('市场调查与分析大赛');
    expect(coverTitleOf('“批改网杯”全国大学生英语翻译大赛')).toBe('英语翻译大赛');
    expect(coverTitleOf('中国大学生广告艺术节学院奖')).toBe('广告艺术节学院奖');
    expect(coverTitleOf('全国高校计算机能力挑战赛')).toBe('计算机能力挑战赛');
    expect(coverTitleOf('2026年第八届全国大学生计算机设计竞赛')).toBe('计算机设计竞赛');
    expect(coverTitleOf('2026—2027赛季华为ICT大赛')).toBe('华为ICT大赛');
  });
  it('不带引号、紧跟“全国/中国”的杯名也放进角标', () => {
    expect(coverOf({ name:'蓝桥杯全国大学生软件和信息技术大赛', professions:['计算机与AI'] })).toEqual({ coverTitle:'软件和信息技术大赛', coverKicker:'蓝桥杯', coverTone:'blue' });
    expect(coverOf({ name:'全国大学生统计建模大赛', professions:['数学与统计'] })).toMatchObject({ coverKicker:'数学与统计', coverTone:'indigo' });
  });
  it('前缀去掉后太短就停，不剩光秃秃的“创新大赛”', () => {
    expect(coverTitleOf('中国国际大学生创新大赛')).toBe('大学生创新大赛');
    expect(coverTitleOf('全国大学生数学竞赛')).toBe('大学生数学竞赛');
  });
  it('去完前缀不剩什么时用原名', () => {
    expect(coverTitleOf('全国大学生')).toBe('全国大学生');
    expect(coverTitleOf('')).toBe('');
  });
  it('角标优先杯名，其次专业大类；颜色按专业大类', () => {
    expect(coverOf({ name:'“批改网杯”全国大学生英语翻译大赛', professions:['外语与教育'] })).toEqual({ coverTitle:'英语翻译大赛', coverKicker:'批改网杯', coverTone:'rose' });
    expect(coverOf({ name:'全国大学生市场调查与分析大赛', professions:['经管与商科'] })).toMatchObject({ coverKicker:'经管与商科', coverTone:'orange' });
    expect(coverOf({ name:'某大赛', professions:['综合/不限专业', '计算机与AI'] })).toMatchObject({ coverKicker:'计算机与AI', coverTone:'blue' });
  });
  it('没有专业大类时按 id 固定取一种颜色，每次一样', () => {
    const first = coverOf({ id:'edition-x', name:'某大赛' });
    expect(first.coverKicker).toBe('大学生竞赛');
    expect(coverOf({ id:'edition-x', name:'某大赛' }).coverTone).toBe(first.coverTone);
    expect(['indigo', 'blue', 'teal', 'purple']).toContain(first.coverTone);
  });
  it('withCover 保留原字段', () => {
    expect(withCover({ id:'a', name:'全国大学生数学建模竞赛', posterUrl:'' })).toMatchObject({ id:'a', posterUrl:'', coverTitle:'数学建模竞赛' });
  });
});

describe('首页瀑布流分列', () => {
  it('两行名称的卡片比一行的高', () => {
    expect(estimateCardHeight({ name:'全国大学生市场调查与分析大赛' })).toBeGreaterThan(estimateCardHeight({ name:'跨境电商大赛' }));
  });
  it('每张卡片放进当前较矮的一列，顺序不丢', () => {
    const items = [{ id:'a', name:'全国大学生市场调查与分析大赛' }, { id:'b', name:'短名' }, { id:'c', name:'短名二' }, { id:'d', name:'短名三' }];
    const { leftItems, rightItems } = splitColumns(items);
    expect(leftItems.map(item => item.id)).toEqual(['a', 'd']);
    expect(rightItems.map(item => item.id)).toEqual(['b', 'c']);
    expect(splitColumns([])).toEqual({ leftItems:[], rightItems:[] });
  });
});
