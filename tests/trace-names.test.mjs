// 读不了的站转追溯、摘要里提取赛事名、标题没有信息量的规则（2026-10-01）
import { describe, expect, it } from 'vitest';
import { contestNameFromSnippet, groupNotices, withTraceName } from '../scripts/server/resolve-notice-leads.mjs';
import { isUnreadableHost } from '../scripts/server/unreadable-hosts.mjs';
import { deterministicCandidateDecision, titleHasNoInfo } from '../scripts/crawler/lib/jevCandidateFilter.mjs';

const SNIPPET = '大赛背景为建强国际传播专业队伍、提升国际传播效能,中国外文局亚太传播中心(人民中国杂志社、中国报道杂志社)紧扣时代脉搏,举办2026年“强国杯”英语能力大赛。本次赛事下设6个竞赛项目:语法竞赛、阅读竞赛';

describe('标题没有信息量', () => {
  it('只有日期、时间、地名的标题（微信推文常见）', () => {
    for (const title of ['2026年9月27日 09:54广东', '2026年9月25日 09:06广东', '2026年9月28日 11:35广东', '09:54', '广东', '北京市', '9月27日 周日 晚上 上海']) {
      expect(titleHasNoInfo(title), title).toBe(true);
    }
  });
  it('有赛事名、哪怕带年份地名的标题不算', () => {
    for (const title of ['2026年全国大学生生命科学竞赛', '关于举办2026年江苏省大学生化工设计竞赛的通知', '广东省大学生程序设计竞赛', '学会动态']) {
      expect(titleHasNoInfo(title), title).toBe(false);
    }
  });
  it('规则直接判成“只当追溯线索”，不让它占读详情的名额，也不调用 Jev', () => {
    expect(deterministicCandidateDecision({ name:'2026年9月27日 09:54广东' })).toMatchObject({ action:'trace', kind:'title_no_info', source:'rule' });
    expect(deterministicCandidateDecision({ name:'2026年全国大学生生命科学竞赛' })).toBeNull();
  });
});

describe('已知读不了的站', () => {
  it('微信公众号文章、百度百科（robots 不让抓）', () => {
    expect(isUnreadableHost('https://mp.weixin.qq.com/s?__biz=abc&mid=1')).toBe(true);
    expect(isUnreadableHost('https://baike.baidu.com/item/x')).toBe(true);
    expect(isUnreadableHost('https://www.culsc.cn/')).toBe(false);
    expect(isUnreadableHost('不是网址')).toBe(false);
  });
});

describe('从摘要里提取赛事名', () => {
  it('“……举办 2026 年‘强国杯’英语能力大赛”', () => {
    expect(contestNameFromSnippet(SNIPPET)).toBe('2026年“强国杯”英语能力大赛');
  });
  it('提取不到就不猜', () => {
    expect(contestNameFromSnippet('学会动态：本周活动安排和报名提醒')).toBe('');
    expect(contestNameFromSnippet('')).toBe('');
  });
  it('只在标题没有信息量或读不了时才换名字，其余原样', () => {
    const candidate = { name:'2026年9月27日 09:54广东', detailUrl:'https://mp.weixin.qq.com/s?a=1', introduction:SNIPPET };
    expect(withTraceName(candidate).name).toBe('2026年9月27日 09:54广东');
    const replaced = withTraceName(candidate, { replaceTitle:true });
    expect(replaced).toMatchObject({ name:'2026年“强国杯”英语能力大赛', originalTitle:'2026年9月27日 09:54广东', nameFromSnippet:true });
    expect(withTraceName({ ...candidate, introduction:'没有赛事名' }, { replaceTitle:true }).name).toBe('2026年9月27日 09:54广东');
  });
  it('同一场比赛的几篇推文（标题不同、摘要相同）归成一组，只搜一次', () => {
    const pages = ['2026年9月27日 09:54广东', '2026年9月25日 09:06广东', '2026年9月28日 11:35广东']
      .map((name, index) => withTraceName({ name, detailUrl:`https://mp.weixin.qq.com/s?mid=${index}`, introduction:SNIPPET }, { replaceTitle:true }));
    const groups = groupNotices(pages);
    expect(groups).toHaveLength(1);
    expect(groups[0].notices).toHaveLength(3);
    expect(groups[0].proposedName).toBe('强国杯英语能力大赛');
  });
  it('提取不出赛事名的，不会进入分组（不搜）', () => {
    expect(groupNotices([withTraceName({ name:'2026年9月27日 09:54广东', detailUrl:'https://mp.weixin.qq.com/s?mid=9', introduction:'没有赛事名' }, { replaceTitle:true })])).toHaveLength(0);
  });
});
