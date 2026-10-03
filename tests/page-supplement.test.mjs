// 关键信息还缺时的补读：按公告标题找正式通知、识别页面图片（2026-10-02）
import { describe, expect, it, vi } from 'vitest';
import { fieldsFromImages, findNoticeTitles, imageCandidates, keyFieldCount, missingKeyFields, ocrImage, pickOfficialNotice, sameSite } from '../scripts/server/page-supplement.mjs';

// 全国数字建筑创新应用大赛官网首页经 Kimi 读出的正文（节选，原样）
const HOME = `大赛介绍

在数字建筑理念已成为业界共识的背景下……2026年将继续举办第十八届全国线上大型应用技能竞赛 “数字建筑创新应用大赛”。

大赛日程

大赛公告

2026 年全国数字建筑创新应用大赛 模拟测试赛通知2026-08-20

关于 2026 年全国数字建筑创新应用大赛全能强化营赠送学生学习账号领取事宜的通知2026-08-12

【重要通知】大赛参赛团队信息修改权限即将关闭！2026-07-14

关于举办2026年全国数字建筑创新应用大赛赛前能力强化训练营的通知2026-06-01

关于举办2026年全国数字建筑创新应用大赛的通知2026-03-30

赛事新闻

【直播预告】2026 全国数字建筑创新应用大赛报名宣讲会2026-04-09`;

describe('还缺什么', () => {
  it('参赛对象和资格都没有、报名截止没有', () => {
    expect(missingKeyFields({ organizer:{ value:'中国建设教育协会' } })).toEqual(['参赛对象', '报名时间']);
    expect(missingKeyFields({ participants:{ value:'在校本科生' }, registration_end:{ value:'2026-07-31' } })).toEqual([]);
    expect(missingKeyFields({ eligibility:{ value:'本科院校' } })).toEqual(['报名时间']);
  });
  it('关键项计数', () => {
    expect(keyFieldCount({ organizer:{}, participants:{}, registration_end:{} })).toBe(3);
  });
});

describe('① 从页面里找正式通知的标题', () => {
  it('挑出“关于举办……的通知”，去掉末尾日期；训练营、测试赛、领账号这类不要', () => {
    expect(findNoticeTitles(HOME, '全国数字建筑创新应用大赛', { year:2026 })).toEqual(['关于举办2026年全国数字建筑创新应用大赛的通知']);
  });
  it('和这场比赛无关的通知不要', () => {
    expect(findNoticeTitles('关于举办2026年全国大学生英语竞赛的通知', '全国数字建筑创新应用大赛')).toEqual([]);
  });
  it('只认和官网同一个网站的结果，学校转发的不算', () => {
    const refs = [
      { title:'关于2026年全国数字建筑创新应用大赛的参赛通知', url:'https://today.hit.edu.cn/article/2026/04/15/129059', content:'' },
      { title:'关于举办2026年全国数字建筑创新应用大赛的通知', url:'http://bisai.ccen.com.cn/notice/88', content:'' },
    ];
    expect(pickOfficialNotice(refs, 'http://bisai.ccen.com.cn', '关于举办2026年全国数字建筑创新应用大赛的通知')?.url).toBe('http://bisai.ccen.com.cn/notice/88');
    expect(pickOfficialNotice(refs.slice(0, 1), 'http://bisai.ccen.com.cn', '关于举办2026年全国数字建筑创新应用大赛的通知')).toBeNull();
  });
  it('同一网站按主域名比', () => {
    expect(sameSite('https://www.ccen.com.cn/a', 'http://bisai.ccen.com.cn')).toBe(true);
    expect(sameSite('https://jwc.zzu.edu.cn/a', 'https://www5.zzu.edu.cn/b')).toBe(true);
    expect(sameSite('https://a.example.org/', 'https://b.other.org/')).toBe(false);
  });
});

describe('② 页面图片', () => {
  it('取页面里的图片和 Kimi 转存的图片；图标、二维码、头像不要；去重', () => {
    const html = '<img src="/assets/Newlogo.png"><img src="https://cdn.x.com/2026/xs-bk-signup.png"><img src="https://cdn.x.com/qrcode.png"><img src="https://cdn.x.com/2026/schedule.png">';
    expect(imageCandidates({ html, pageUrl:'http://bisai.ccen.com.cn/home', renderedImages:['https://kimi-web-img.kimi.ai/a/1.png', 'https://kimi-web-img.kimi.ai/a/1.png'] }))
      .toEqual(['https://cdn.x.com/2026/xs-bk-signup.png', 'https://cdn.x.com/2026/schedule.png', 'https://kimi-web-img.kimi.ai/a/1.png']);
  });
  it('识别：太小的图（图标）不送识别；识别结果原样返回', async () => {
    const big = Buffer.alloc(20 * 1024, 1);
    const fetchImpl = vi.fn(async (url) => (String(url).includes('deepseek')
      ? { ok:true, json:async () => ({ choices:[{ message:{ content:'本科组\n适用本科院校，单独排名' } }] }) }
      : { ok:true, headers:{ get:() => 'image/png' }, arrayBuffer:async () => big }));
    expect(await ocrImage('https://cdn.x.com/bk.png', { key:'k', fetchImpl })).toBe('本科组\n适用本科院校，单独排名');
    const tiny = vi.fn(async () => ({ ok:true, headers:{ get:() => 'image/png' }, arrayBuffer:async () => Buffer.alloc(500) }));
    expect(await ocrImage('https://cdn.x.com/icon.png', { key:'k', fetchImpl:tiny })).toBeNull();
  });
  it('哪些项的依据只在图片识别的文字里', () => {
    const extracted = {
      organizer:{ value:'中国建设教育协会', quote:'主办单位中国建设教育协会' },
      participants:{ value:'本科院校', quote:'本科组 适用本科院校，单独排名' },
    };
    expect(fieldsFromImages(extracted, '主办单位中国建设教育协会及协办单位……', '图片1：本科组\n适用本科院校，单独排名')).toEqual(['participants']);
    expect(fieldsFromImages(extracted, '主办单位中国建设教育协会', '')).toEqual([]);
  });
});

describe('实跑发现的两处（2026-10-03）', () => {
  it('同站的首页不算正式通知', () => {
    const refs = [{ title:'2026年18届全国数字建筑创新应用大赛', url:'http://bisai.ccen.com.cn/home', content:'关于举办2026年全国数字建筑创新应用大赛的通知' }];
    expect(pickOfficialNotice(refs, 'http://bisai.ccen.com.cn', '关于举办2026年全国数字建筑创新应用大赛的通知')).toBeNull();
  });
  it('图片文字按相关程度排序：报名卡片、日程图在前，广告横幅在后或不要', async () => {
    const { ocrRelevance } = await import('../scripts/server/page-supplement.mjs');
    expect(ocrRelevance('本科组\n适用本科院校，单独排名\n立即报名')).toBeGreaterThan(0);
    expect(ocrRelevance('大赛报名 4月-7月31日 全国总决赛 10月18日')).toBeGreaterThan(ocrRelevance('本科组 适用本科院校'));
    expect(ocrRelevance('学生专属福利领取 免费课程卡 价值¥2400 扫码添加企微')).toBeLessThanOrEqual(0);
  });
});
