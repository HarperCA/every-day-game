import { describe, expect, it } from 'vitest';
import { competitionNameFromNotice, followupQuery, selectLeads } from '../scripts/server/resolve-notice-leads.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { isNoticeTitle } = require('../apps/miniprogram/cloudfunctions/adminData/noticeResolution.js');

describe('通知追溯', () => {
  it('从高校通知中提取赛事名并搜索官网', () => {
    const title = '关于荣成学院举办“2026年全国高校商业精英挑战赛跨境电商赛道”的通知';
    expect(competitionNameFromNotice(title)).toBe('2026年全国高校商业精英挑战赛跨境电商赛道');
    expect(followupQuery(title)).toContain('主办方 赛事官网 官方报名');
  });

  it('排除原通知页和非安全地址，结果仅作待核验线索', () => {
    expect(selectLeads([
      { url:'https://school.example.edu/notice', title:'报名通知' },
      { url:'http://event.example.org', title:'大赛官网' },
      { url:'https://event.example.org', title:'大赛官网' },
    ], 'https://school.example.edu/notice')).toEqual([
      { url:'https://event.example.org', title:'大赛官网', summary:'', status:'待核验' },
    ]);
  });
});

describe('栏目标签式的通知标题', () => {
  // 公众号/资讯站把「竞赛通知丨」当栏目标签挂在真实赛事名前面，抓下来就成了
  // 「竞赛通知丨XX大赛」。这是一篇通知，赛事名得从后半截解析出来，不能直接入库。
  // 这两条是库里真实漏网的样本（2026-09-23 由用户发现）。
  it.each([
    '竞赛通知丨“共同关切”——2026全国大学生花园设计建造竞赛【社区花园赛道】',
    '赛事通知 | 首届全国大学生零碳科技创新大赛哈工大青柠校园赛等你报名!',
    '通知：2026年XX大赛',
    '竞赛公告｜XX挑战赛',
  ])('识别为通知：%s', title => {
    expect(isNoticeTitle(title)).toBe(true);
  });

  it('不误伤正常赛事名', () => {
    // 分隔符是关键：没有「标签+分隔符」这个结构就不算栏目标签。
    expect(isNoticeTitle('2026年辽宁省大学生智慧电力运行控制创新竞赛')).toBe(false);
    expect(isNoticeTitle('第二十三届中国研究生数学建模竞赛')).toBe(false);
    expect(isNoticeTitle('全国大学生通知工程竞赛')).toBe(false);
  });
});
