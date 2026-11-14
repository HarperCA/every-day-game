// 判断官网（2026-11-08 用户定）：维护一个比赛前，先判断拿到的起点网址是不是这个比赛的官网，是才往下维护。全部由程序判断，不调 AI。
//   网址判断：不用打开就能否掉的（附件、学校主站/部门、政府、云存储、公众号、屏蔽、单篇通知、往年旧网址）
//   宽松有名：页面标题和比赛名的宽松比对（只和标题比）
//   判断官网：网址判断 → 打开（空壳页换无头浏览器）→ 跳转后再判断 → 比名字（旧页面只看网址里的年份，2026-11-13）
//   来源候选、算域名比赛数：从来源表的官方来源推起点候选
// 网址例子来自补官网和 DeepSeek 试跑里的真实网址。读网页、浏览器都用假的；比赛库用内存库。
import { describe, expect, test } from 'vitest';
import { open, seed } from '../../../test/复用/样例数据.mjs';
import { 网址判断, 宽松有名, 判断官网, 来源候选, 算域名比赛数, 学校部门前缀, 带浏览器读网页 } from '../../判断官网.mjs';

describe('网址判断（不用打开）', () => {
  const 否 = (网址, 原因, 选项) => expect(网址判断(网址, 选项), 网址).toEqual({ 可以: false, 原因 });
  const 行 = (网址, 选项) => expect(网址判断(网址, 选项), 网址).toEqual({ 可以: true, 原因: '' });

  test('附件下载链接：download.jsp、DownloadAttachUrl、wbfileid，和 pdf/doc/docx/xls/xlsx/zip/rar 结尾的', () => {
    否('https://www.hlju.edu.cn/system/_content/download.jsp?urltype=news.DownloadAttachUrl&owner=1175617534&wbfileid=1452439', '附件下载链接');
    否('https://www.abc.org/x?wbfileid=12', '附件下载链接');
    for (const 尾 of ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'zip', 'rar', 'PDF']) 否(`https://www.abc.org/files/规程.${尾}`, '附件下载链接');
    否('https://www.abc.org/files/a.pdf?v=2', '附件下载链接');
  });
  test('往年旧网址：网址里的年份最新的那个比库里最新一届还早；没年份、不知道库里最新年份时不算旧', () => {
    否('http://www.chinagdf.com.cn/sj/2021_jwb01.html', '往年旧页面（最新 2021 年，库里最新 2026 年）', { 库里最新年份: 2026 });
    行('http://www.chinagdf.com.cn/sj/2021_jwb01.html');
    行('http://www.chinagdf.com.cn/sj/2026_jwb01.html', { 库里最新年份: 2026 });
    行('https://yywz.org.cn/', { 库里最新年份: 2026 });
    行('https://www.cmes.org/a2019b/index.html', { 库里最新年份: 2026 });   // 字母中间的四位数不当年份（哈希、编号）
  });
  test('二级 edu.cn 域名（去掉 www 后是 xxx.edu.cn）不按网址否掉：学校主站和 mcm.edu.cn 这类比赛官网分不开，交给打开后只看标题', () => {
    行('https://www.bift.edu.cn/');
    行('https://bift.edu.cn/index.htm');
    行('https://www.mcm.edu.cn/');
    行('https://www.cahe.edu.cn/');
  });
  test('学校部门网站：.edu.cn 主机名第一段是 www、jwc、tuanwei 这类；比赛专用子站可以', () => {
    否('https://jwc.xjtu.edu.cn/info/1002/12345.htm', '学校部门网站');
    否('https://tuanwei.hit.edu.cn/', '学校部门网站');
    否('https://www.cs.hit.edu.cn/', '学校部门网站');
    行('https://12umic.hit.edu.cn/');
    行('https://iche.zju.edu.cn/');
    expect(学校部门前缀).toEqual(expect.arrayContaining(['www', 'jwc', 'jw', 'news', 'xxgk', 'tuanwei', 'tw', 'cxcy', 'cxcyxy', 'xsc', 'zs', 'yjs', 'kjc']));
  });
  test('政府网站、云存储/CDN、公众号、屏蔽名单', () => {
    否('https://www.moe.gov.cn/srcsite/A08/s7056/202403/t20240301_1117707.html', '政府网站');
    否('https://jyt.hubei.gov.cn/', '政府网站');
    否('https://abc.oss-cn-beijing.aliyuncs.com/x.html', '云存储/CDN');
    否('https://file-1250000000.cos.ap-shanghai.myqcloud.com/a.html', '云存储/CDN');
    否('https://cdn.abc.com/a.html', '云存储/CDN');
    否('https://img.qiniu.abc.com/a.html', '云存储/CDN');
    行('https://jobs.abc.com/');   // jobs. 里有 obs. 也不算云存储
    否('https://mp.weixin.qq.com/s/abcdef', '公众号');
    否('https://www.saikr.com/vse/1', '屏蔽名单里的网站', { 屏蔽: ['saikr.com'] });
    否('https://xx.52jingsai.com/a', '屏蔽名单里的网站', { 屏蔽: ['52jingsai.com'] });
    行('https://www.saikr.com/vse/1');
  });
  test('单篇通知：带日期或编号的单篇文章网址', () => {
    否('https://www.cmes.org/notice/010c5f85554e440e99d702008b58a26f.html', '单篇通知');
    否('https://www.ccf.org.cn/Chapters/DC/ODC/wyhdt/2026-03-23/865096.shtml', '单篇通知', { 库里最新年份: 2026 });
    否('https://www.abc.org.cn/2025/0623/c123a456/page.htm', '单篇通知');
    否('https://www.abc.org.cn/a/2025/0623/123.html', '单篇通知', { 库里最新年份: 2025 });
    否('https://www.cnaec.com.cn/info/1150/4898.htm', '单篇通知');
    否('https://www.abc.org/c2140a268666/page.htm', '单篇通知');
    否('https://www.abc.org/show.asp?new_id=12', '单篇通知');
    否('https://www.abc.org/news/2341.html', '单篇通知');
    否('https://www.abc.org/detail/88.html', '单篇通知');
  });
  test('可以的：独立域名首页、比赛专用子站、平台上的比赛页', () => {
    行('https://12umic.hit.edu.cn/', { 库里最新年份: 2026 });
    行('https://www.jienengjianpai.org/', { 库里最新年份: 2026 });
    行('https://yywz.org.cn/');
    行('https://www.boxuegu.com/matchTrack/detail/?id=10042', { 库里最新年份: 2026 });
  });
  test('不是网址', () => {
    expect(网址判断('不是网址')).toEqual({ 可以: false, 原因: '网址不对' });
    expect(网址判断('')).toEqual({ 可以: false, 原因: '网址不对' });
  });
});

describe('宽松有名（只和网页标题比）', () => {
  test('去掉引号里的“××杯”、括号、通用词后，最长公共片段整段至少 6 个字、去掉通用词后至少 4 个字', () => {
    expect(宽松有名('‘大工能动杯’全国大学生节能减排社会实践与科技竞赛', '全国大学生节能减排竞赛官方网站')).toBe('全国大学生节能减排');
    expect(宽松有名('“挑战杯”全国大学生课外学术科技作品竞赛', '挑战杯官网')).toBe('');
    expect(宽松有名('全国大学生金融创意设计大赛（2026）', '全国大学生金融创意设计大赛官网 - 首页')).toBe('全国大学生金融创意设计大赛');
  });
  test('误认防护：工商银行主页、学院主页的 4 字片段对不上', () => {
    expect(宽松有名('全国大学生金融创意设计大赛', '中国工商银行')).toBe('');
    expect(宽松有名('全国大学生生态环境保护创意大赛', '南京大学生态环境学院')).toBe('');
    expect(宽松有名('全国大学生创新设计大赛', '全国大学生创新设计')).toBe('');   // 整段够长，但去掉通用词什么都不剩
  });
  test('纯英文片段至少 8 个字母', () => {
    expect(宽松有名('RoboMaster 机甲大师高校系列赛', 'RoboMaster')).toBe('robomaster');
    expect(宽松有名('ICPC 国际大学生程序设计竞赛', 'ICPC Foundation')).toBe('');
  });
  test('空的对不上', () => {
    expect(宽松有名('全国大学生节能减排社会实践与科技竞赛', '')).toBe('');
    expect(宽松有名('', '全国大学生节能减排竞赛')).toBe('');
  });
});

// ---- 判断官网：假的读网页、浏览器 ----
const 长文 = '欢迎访问。'.repeat(80);   // 400 字，不算空壳
const 页 = (网址, title, text = 长文, 改 = {}) => ({ url: 网址, finalUrl: 网址, status: '成功', title, text, links: [], error: '', ...改 });
// 表：网址 → 读网页结果 或 Error
function 假读网页(表) {
  const 调用 = [];
  const 读 = async 网址 => {
    调用.push(网址);
    const 结果 = 表[网址];
    if (结果 instanceof Error) throw 结果;
    return 结果 || { url: 网址, finalUrl: 网址, status: '网络错误', title: '', text: '', links: [], error: '连不上' };
  };
  读.调用 = 调用;
  return 读;
}
// 表：网址 → { html, 网址 }（网址是跳转后的）
function 假浏览器(表) {
  const 记 = { 打开: [], 关: 0 };
  return {
    记,
    async 新页面() {
      let 当前 = '';
      return {
        页: { async 打开(网址) { 记.打开.push(网址); 当前 = 网址; }, async 源码() { return 表[当前]?.html || ''; }, 网址: () => 表[当前]?.网址 || 当前 },
        async 关() { 记.关 += 1; },
      };
    },
  };
}
const 节能减排 = { name: '‘大工能动杯’全国大学生节能减排社会实践与科技竞赛', aliases: ['节能减排大赛'] };
const 金融 = { name: '全国大学生金融创意设计大赛', aliases: [] };

describe('判断官网', () => {
  test('网址规则先否掉的不打开', async () => {
    const 读网页 = 假读网页({});
    expect(await 判断官网('https://tuanwei.hit.edu.cn/', 金融, { 读网页 })).toEqual({ 是: false, 原因: '学校部门网站', 最终网址: 'https://tuanwei.hit.edu.cn/', 对上: '', 标题: '' });
    expect(await 判断官网('http://www.chinagdf.com.cn/sj/2021_jwb01.html', { name: '健威杯全国大学生家具设计大赛' }, { 读网页, 库里最新年份: 2026 }))
      .toMatchObject({ 是: false, 原因: '往年旧页面（最新 2021 年，库里最新 2026 年）' });
    expect(await 判断官网('https://www.saikr.com/vse/1', 金融, { 读网页, 屏蔽: ['saikr.com'] })).toMatchObject({ 是: false, 原因: '屏蔽名单里的网站' });
    expect(读网页.调用).toEqual([]);
  });
  test('标题或正文里有比赛全名（任一写法）→ 是官网，对上“全名”', async () => {
    const 读网页 = 假读网页({
      'https://www.jienengjianpai.org/': 页('https://www.jienengjianpai.org/', '首页', `${长文}节能减排大赛通知`),
      'https://yywz.org.cn/': 页('https://yywz.org.cn/', '全国大学生金融创意设计大赛'),
    });
    expect(await 判断官网('https://www.jienengjianpai.org/', 节能减排, { 读网页 })).toEqual({ 是: true, 原因: '页面上有比赛名', 最终网址: 'https://www.jienengjianpai.org/', 对上: '全名', 标题: '首页' });
    expect(await 判断官网('https://yywz.org.cn/', 金融, { 读网页 })).toMatchObject({ 是: true, 对上: '全名' });
  });
  test('网页标题按宽松规则对上 → 是官网，对上“标题宽松”', async () => {
    const 读网页 = 假读网页({ 'https://www.jienengjianpai.org/': 页('https://www.jienengjianpai.org/', '全国大学生节能减排竞赛官方网站') });
    expect(await 判断官网('https://www.jienengjianpai.org/', 节能减排, { 读网页, 库里最新年份: 2026 }))
      .toEqual({ 是: true, 原因: '网页标题对上「全国大学生节能减排」', 最终网址: 'https://www.jienengjianpai.org/', 对上: '标题宽松', 标题: '全国大学生节能减排竞赛官方网站' });
  });
  test('平台上的比赛页（boxuegu 赛道页）', async () => {
    const 网址 = 'https://www.boxuegu.com/matchTrack/detail/?id=10042';
    const 读网页 = 假读网页({ [网址]: 页(网址, '传智杯全国IT技能大赛-赛道详情') });
    expect(await 判断官网(网址, { name: '传智杯全国IT技能大赛' }, { 读网页, 库里最新年份: 2026 })).toMatchObject({ 是: true, 对上: '全名', 最终网址: 网址 });
  });
  test('二级 edu.cn 域名只看标题：mcm.edu.cn 标题有比赛名 → 是；学校主页正文里有比赛新闻、标题没有 → 不是', async () => {
    const 读网页 = 假读网页({
      'https://www.mcm.edu.cn/': 页('https://www.mcm.edu.cn/', '全国大学生数学建模竞赛'),
      'https://www.bift.edu.cn/': 页('https://www.bift.edu.cn/', '北京服装学院', `${长文}我校学生获全国大学生金融创意设计大赛一等奖`),
    });
    expect(await 判断官网('https://www.mcm.edu.cn/', { name: '全国大学生数学建模竞赛' }, { 读网页 })).toEqual({ 是: true, 原因: '页面上有比赛名', 最终网址: 'https://www.mcm.edu.cn/', 对上: '全名', 标题: '全国大学生数学建模竞赛' });
    expect(await 判断官网('https://www.bift.edu.cn/', 金融, { 读网页 }))
      .toEqual({ 是: false, 原因: '二级 edu.cn 网站（可能是学校主站），标题里没有比赛名（标题：北京服装学院）', 最终网址: 'https://www.bift.edu.cn/', 对上: '', 标题: '北京服装学院' });
  });
  test('误认防护：标题对不上、正文里有相近的词也不算（宽松只和标题比）', async () => {
    const 读网页 = 假读网页({ 'https://www.icbc.com.cn/': 页('https://www.icbc.com.cn/', '中国工商银行', `${长文}全国大学生金融创意设计`) });
    expect(await 判断官网('https://www.icbc.com.cn/', 金融, { 读网页 }))
      .toEqual({ 是: false, 原因: '页面上没有比赛名（标题：中国工商银行）', 最终网址: 'https://www.icbc.com.cn/', 对上: '', 标题: '中国工商银行' });
  });
  test('打不开：读网页报失败或抛错', async () => {
    const 读网页 = 假读网页({
      'https://a.org/': { url: 'https://a.org/', finalUrl: 'https://a.org/', status: '超时', title: '', text: '', links: [], error: '20 秒没响应' },
      'https://b.org/': new Error('读网页崩了'),
      'https://c.org/': { url: 'https://c.org/', finalUrl: 'https://c.org/', status: 'HTTP错误', title: '', text: '', links: [], error: '' },
    });
    expect(await 判断官网('https://a.org/', 金融, { 读网页 })).toEqual({ 是: false, 原因: '打不开：20 秒没响应', 最终网址: 'https://a.org/', 对上: '', 标题: '' });
    expect(await 判断官网('https://b.org/', 金融, { 读网页 })).toMatchObject({ 是: false, 原因: '打不开：读网页崩了' });
    expect(await 判断官网('https://c.org/', 金融, { 读网页 })).toMatchObject({ 是: false, 原因: '打不开：HTTP错误' });
  });
  test('空壳页（看得到的字不到 200）有浏览器就用无头浏览器再开一次；用完关页面', async () => {
    const 网址 = 'https://www.jsjds.com.cn/';
    const 读网页 = 假读网页({ [网址]: 页(网址, '', '加载中', { status: '正文太短', error: '正文太短' }) });
    const 浏览器 = 假浏览器({ [网址]: { 网址: `${网址}#/home`, html: `<html><head><title>全国大学生金融创意设计大赛 &amp; 官网</title><script>var a = "全国";</script></head><body><div>${长文}</div></body></html>` } });
    expect(await 判断官网(网址, 金融, { 读网页, 浏览器 })).toEqual({ 是: true, 原因: '页面上有比赛名（无头浏览器）', 最终网址: `${网址}#/home`, 对上: '全名', 标题: '全国大学生金融创意设计大赛 & 官网' });
    expect(浏览器.记).toEqual({ 打开: [网址], 关: 1 });
  });
  test('空壳页没有浏览器、浏览器出错，就用直接下载的结果；正文够长不开浏览器', async () => {
    const 网址 = 'https://www.jsjds.com.cn/';
    const 读网页 = 假读网页({ [网址]: 页(网址, '首页', '加载中'), 'https://ok.org/': 页('https://ok.org/', '首页') });
    expect(await 判断官网(网址, 金融, { 读网页 })).toMatchObject({ 是: false, 原因: '页面上没有比赛名（标题：首页）' });
    const 坏浏览器 = { async 新页面() { throw new Error('浏览器起不来'); } };
    expect(await 判断官网(网址, 金融, { 读网页, 浏览器: 坏浏览器 })).toMatchObject({ 是: false, 原因: '页面上没有比赛名（标题：首页）' });
    const 浏览器 = 假浏览器({});
    await 判断官网('https://ok.org/', 金融, { 读网页, 浏览器 });
    expect(浏览器.记.打开).toEqual([]);
  });
  test('跳转后的最终网址也要再过一次网址判断', async () => {
    const 读网页 = 假读网页({
      'https://jsds.abc.cn/': 页('https://jsds.abc.cn/', '全国大学生金融创意设计大赛', 长文, { finalUrl: 'https://jwc.bift.edu.cn/' }),
      'https://d.org/': 页('https://d.org/', '全国大学生金融创意设计大赛', 长文, { finalUrl: 'https://d.org/2021/index.html' }),
    });
    expect(await 判断官网('https://jsds.abc.cn/', 金融, { 读网页 })).toEqual({ 是: false, 原因: '跳转后是学校部门网站（https://jwc.bift.edu.cn/）', 最终网址: 'https://jwc.bift.edu.cn/', 对上: '', 标题: '全国大学生金融创意设计大赛' });
    expect(await 判断官网('https://d.org/', 金融, { 读网页, 库里最新年份: 2026 })).toMatchObject({ 是: false, 原因: '跳转后是往年旧页面（最新 2021 年，库里最新 2026 年）（https://d.org/2021/index.html）' });
  });
  test('往年旧页面只看网址（含跳转后的最终网址）里的年份，不看标题和正文（2026-11-13：实测把“最新 1999 年”的英语竞赛官网、“最新 2018 年”的成图大赛官网误判）', async () => {
    const 读网页 = 假读网页({
      'https://www.chinagdf.com.cn/': 页('https://www.chinagdf.com.cn/', '2021年健威杯全国大学生家具设计大赛', `2019年回顾${长文}2026年报名`),
      'https://www.chinaneccs.cn/': 页('https://www.chinaneccs.cn/', '全国大学生英语竞赛', `1999年创办${长文}`),
      'https://www.chengtudasai.com/': 页('https://www.chengtudasai.com/', '全国大学生先进成图技术与产品信息建模创新大赛', `2018年第十一届${长文}`),
    });
    expect(await 判断官网('https://www.chinagdf.com.cn/', { name: '健威杯全国大学生家具设计大赛' }, { 读网页, 库里最新年份: 2026 })).toMatchObject({ 是: true });
    expect(await 判断官网('https://www.chinaneccs.cn/', { name: '全国大学生英语竞赛' }, { 读网页, 库里最新年份: 2026 })).toMatchObject({ 是: true });
    expect(await 判断官网('https://www.chengtudasai.com/', { name: '全国大学生先进成图技术与产品信息建模创新大赛' }, { 读网页, 库里最新年份: 2026 })).toMatchObject({ 是: true });
  });
});

describe('来源候选', () => {
  const 来源们 = [
    { url: 'https://www.cmes.org/notice/010c5f85554e440e99d702008b58a26f.html', source_type: 'organizer_notice', ordinal: 3 },
    { url: 'https://www.jienengjianpai.org/news/1.html', source_type: 'official_website', ordinal: 1 },
    { url: 'https://www.boxuegu.com/matchTrack/detail/?id=10042', source_type: 'organizer_website', ordinal: 2 },
    { url: 'https://www.boxuegu.com/news/12345.html', source_type: 'organizer_notice', ordinal: 2 },
    { url: 'https://www.boxuegu.com/files/规程.pdf', source_type: 'organizer_notice', ordinal: 2 },
    { url: 'https://jyt.hubei.gov.cn/bmdt/2026/0301/a.html', source_type: 'authority_notice', ordinal: 3 },
    { url: 'https://www.moe.gov.cn/a.html', source_type: 'organizer_notice', ordinal: 3 },
    { url: 'https://www.jienengjianpai.org/files/a.pdf', source_type: 'competition_notice', ordinal: 3 },
    { url: 'https://jwc.xjtu.edu.cn/info/1002/12345.htm', source_type: 'organizer_notice', ordinal: 1 },
    { url: 'https://12umic.hit.edu.cn/info/1002/1.htm', source_type: 'competition_notice', ordinal: 1 },
    { url: 'https://www.saikr.com/vse/1', source_type: 'organizer_website', ordinal: 3 },
    { url: '不是网址', source_type: 'organizer_website', ordinal: 3 },
  ];
  const 域名比赛数 = new Map([['boxuegu.com', 5], ['cmes.org', 1], ['jienengjianpai.org', 1]]);
  test('官网/主办方网站先、主办方通知再、其他最后，同类届次新的先；非平台取首页，平台留那一页；权威名单不进；去重', () => {
    const { 候选, 跳过 } = 来源候选(来源们, { 屏蔽: ['saikr.com'], 域名比赛数 });
    expect(候选).toEqual([
      { 网址: 'https://www.boxuegu.com/matchTrack/detail/?id=10042', 依据: 'organizer_website https://www.boxuegu.com/matchTrack/detail/?id=10042（平台，留这一页）' },
      { 网址: 'https://www.jienengjianpai.org/', 依据: 'official_website https://www.jienengjianpai.org/news/1.html' },
      { 网址: 'https://www.cmes.org/', 依据: 'organizer_notice https://www.cmes.org/notice/010c5f85554e440e99d702008b58a26f.html' },
      { 网址: 'https://12umic.hit.edu.cn/', 依据: 'competition_notice https://12umic.hit.edu.cn/info/1002/1.htm' },
    ]);
    expect(跳过).toEqual([
      'saikr.com：屏蔽名单里的网站',
      '不是网址：网址不对',
      'moe.gov.cn：政府网站',
      'boxuegu.com：平台上的单篇通知',
      'boxuegu.com：平台上的附件下载链接',
      'jwc.xjtu.edu.cn：学校部门网站',
    ]);
    expect(候选.some(x => x.网址.includes('hubei'))).toBe(false);
  });
  test('搜索记忆里“不算官网的网址”（2026-11-13）：推出来的候选在名单里就跳过（不分 www、结尾斜杠），写进跳过', () => {
    const { 候选, 跳过 } = 来源候选(来源们, { 屏蔽: ['saikr.com'], 域名比赛数, 不算官网: ['https://jienengjianpai.org（页面上没有比赛名，2026-11-13）', 'https://www.boxuegu.com/matchTrack/detail/?id=10042（学校主站，2026-11-12）'] });
    expect(候选.map(x => x.网址)).toEqual(['https://www.cmes.org/', 'https://12umic.hit.edu.cn/']);
    expect(跳过).toContain('https://www.jienengjianpai.org/：以前判断过不算官网（页面上没有比赛名，2026-11-13）');
    expect(跳过).toContain('https://www.boxuegu.com/matchTrack/detail/?id=10042：以前判断过不算官网（学校主站，2026-11-12）');
  });
  test('没给域名比赛数就都不算平台；没有来源就空', () => {
    expect(来源候选([{ url: 'https://www.boxuegu.com/matchTrack/detail/?id=10042', source_type: 'organizer_website', ordinal: 1 }]).候选)
      .toEqual([{ 网址: 'https://www.boxuegu.com/', 依据: 'organizer_website https://www.boxuegu.com/matchTrack/detail/?id=10042' }]);
    expect(来源候选([])).toEqual({ 候选: [], 跳过: [] });
  });
});

describe('算域名比赛数', () => {
  test('统计官方有效来源的主机名（去掉 www）下挂了几个不同比赛；非官方、无效、已删除届次的不算', () => {
    const db = open(); seed(db);
    db.transaction(tx => {
      const 源 = (id, edition_id, url, 改 = {}) => tx.insert('source', id, { edition_id, url, source_type: 'organizer_notice', is_official: true, validity_status: 'valid', ...改 });
      源('s1', 'ed-math-2025', 'https://www.a.org/1.html');
      源('s2', 'ed-math-2026', 'https://a.org/2.html');
      源('s3', 'ed-art-2026', 'https://www.a.org/3.html');
      源('s4', 'ed-art-2026', 'https://b.org/');
      源('s5', 'ed-math-2026', 'https://c.org/', { is_official: false });
      源('s6', 'ed-math-2026', 'https://d.org/', { validity_status: 'invalid' });
      源('s7', 'ed-art-next', 'https://e.org/');
    });
    db.标记删除('edition', 'ed-art-next', { by: '测试', at: '2026-10-29T12:00:00.000Z' });
    const 数 = 算域名比赛数(db);
    expect(Object.fromEntries(数)).toEqual({ 'a.org': 2, 'b.org': 1 });
    db.close();
  });
});

// 2026-11-13 用户定：起点候选、找到的官网“打不开”（超时、连接错误、5xx、403/405 等）时，先用无头浏览器再打开一次判断
describe('打不开时换无头浏览器再开一次（2026-11-13）', () => {
  const 打不开 = (网址, status, error, 改 = {}) => ({ url: 网址, finalUrl: 网址, status, title: '', text: '', links: [], error, ...改 });
  const 官网html = `<html><head><title>全国大学生金融创意设计大赛</title></head><body><div>${长文}</div></body></html>`;
  test('超时、网络错误、HTTP 5xx/403/405、读网页抛错：浏览器能打开就照常判断，原因注明无头浏览器', async () => {
    const 读网页 = 假读网页({
      'https://a.org/': 打不开('https://a.org/', '超时', '20 秒没响应'),
      'https://b.org/': 打不开('https://b.org/', 'HTTP错误', '对方返回 503', { httpStatus: 503 }),
      'https://c.org/': 打不开('https://c.org/', 'HTTP错误', '对方返回 403', { httpStatus: 403 }),
      'https://d.org/': new Error('读网页崩了'),
    });
    const 浏览器 = 假浏览器(Object.fromEntries(['https://a.org/', 'https://b.org/', 'https://c.org/', 'https://d.org/', 'https://e.org/'].map(u => [u, { html: 官网html }])));
    for (const 网址 of ['https://a.org/', 'https://b.org/', 'https://c.org/', 'https://d.org/', 'https://e.org/']) {
      expect(await 判断官网(网址, 金融, { 读网页, 浏览器 }), 网址).toMatchObject({ 是: true, 原因: '页面上有比赛名（无头浏览器）', 标题: '全国大学生金融创意设计大赛' });
    }
    expect(浏览器.记.打开).toHaveLength(5);
    expect(浏览器.记.关).toBe(5);
  });
  test('浏览器也打不开（起不来、打开抛错、对方返回 4xx/5xx、没有文字）：还是“打不开”，原因写两次都打不开', async () => {
    const 读网页 = 假读网页({ 'https://a.org/': 打不开('https://a.org/', '超时', '20 秒没响应') });
    const 坏 = { async 新页面() { throw new Error('浏览器起不来'); } };
    expect(await 判断官网('https://a.org/', 金融, { 读网页, 浏览器: 坏 })).toMatchObject({ 是: false, 原因: '打不开：20 秒没响应；无头浏览器也打不开：浏览器起不来' });
    const 回503 = { async 新页面() { return { 页: { async 打开() { return { httpStatus: 503 }; }, async 源码() { return 官网html; }, 网址: () => 'https://a.org/' }, async 关() {} }; } };
    expect(await 判断官网('https://a.org/', 金融, { 读网页, 浏览器: 回503 })).toMatchObject({ 是: false, 原因: '打不开：20 秒没响应；无头浏览器也打不开：对方返回 503' });
    const 空 = 假浏览器({ 'https://a.org/': { html: '<html><body></body></html>' } });
    expect(await 判断官网('https://a.org/', 金融, { 读网页, 浏览器: 空 })).toMatchObject({ 是: false, 原因: '打不开：20 秒没响应；无头浏览器也打不开：打开后没有文字' });
  });
  test('HTTP 404、robots 不允许、网址不安全、不支持的类型：不换浏览器', async () => {
    const 读网页 = 假读网页({
      'https://a.org/': 打不开('https://a.org/', 'HTTP错误', '对方返回 404', { httpStatus: 404 }),
      'https://b.org/': 打不开('https://b.org/', 'robots不允许', 'robots 不允许'),
      'https://c.org/': 打不开('https://c.org/', '网址不安全', '内网地址'),
      'https://d.org/': 打不开('https://d.org/', '不支持的类型', 'image/png'),
    });
    const 浏览器 = 假浏览器({});
    for (const 网址 of ['https://a.org/', 'https://b.org/', 'https://c.org/', 'https://d.org/']) {
      expect((await 判断官网(网址, 金融, { 读网页, 浏览器 })).原因, 网址).toMatch(/^打不开：/);
    }
    expect(浏览器.记.打开).toEqual([]);
  });
  test('带浏览器读网页：给找官网核实用的读网页，打不开时换浏览器（交回读网页那样的结果），没给浏览器原样交回', async () => {
    const 读网页 = 假读网页({ 'https://a.org/': 打不开('https://a.org/', '网络错误', '连接被拒绝'), 'https://ok.org/': 页('https://ok.org/', '首页') });
    expect(带浏览器读网页(读网页, null)).toBe(读网页);
    const 读 = 带浏览器读网页(读网页, 假浏览器({ 'https://a.org/': { html: 官网html, 网址: 'https://a.org/home' } }));
    expect(await 读('https://a.org/')).toMatchObject({ status: '成功', title: '全国大学生金融创意设计大赛', finalUrl: 'https://a.org/home', 用了浏览器: true });
    expect(await 读('https://ok.org/')).toMatchObject({ status: '成功', title: '首页' });
    const 坏 = 带浏览器读网页(读网页, { async 新页面() { throw new Error('起不来'); } });
    expect(await 坏('https://a.org/')).toMatchObject({ status: '网络错误', error: '连接被拒绝；无头浏览器也打不开：起不来' });
  });
});
