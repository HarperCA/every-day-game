// 判重命中“库里已有赛事”的通知：整理成追溯清单，而不是丢掉（2026-09-29）
import { describe, expect, it } from 'vitest';
import { collectMentions, mentionSearchTargets, noticeLeads, primaryRecord, urlsInText } from '../scripts/server/known-event-mentions.mjs';

const masters = [
  { id:'evt-bim', standard_name:'辽宁省大学生BIM应用技能大赛', recordIds:['r-bim-2025'] },
  { id:'evt-ah', standard_name:'安徽省大学生创意设计大赛', recordIds:['r-ah'] },
];
const recordsById = new Map([
  ['r-bim-2025', { id:'r-bim-2025', dataStatus:'archived', editionYear:'2025', name:'辽宁省大学生BIM应用技能大赛' }],
  ['r-ah', { id:'r-ah', dataStatus:'quarantined', name:'安徽省大学生创意设计大赛', schedule:{ registration_end:'2026-10-07T00:00:00Z' } }],
]);
const hit = (name, url, matchedId, intro = '') => ({ candidate:{ name, detailUrl:url, introduction:intro }, match:{ verdict:'duplicate', matchedId, reason:'标题中完整包含' } });
const buckets = { duplicate:[
  hit('关于举办2026年第七届辽宁省大学生BIM应用技能大赛的通知', 'https://s/1', 'evt-bim', '详见官网 https://bim.example.org/2026 报名'),
  hit('2022年第三届辽宁省大学生BIM应用技能大赛', 'https://s/2', 'evt-bim'),
  hit('关于举办2026年安徽省大学生创意设计大赛校级选拔赛的通知', 'https://s/3', 'evt-ah'),
], likely_duplicate:[], same_event_other_tier:[], uncertain:[{ candidate:{ name:'拿不准的', detailUrl:'https://s/9' }, match:{ verdict:'uncertain', matchedId:'evt-bim' } }] };

describe('抓取中提到的已有赛事', () => {
  const groups = collectMentions([buckets], masters, recordsById);
  it('按赛事分组；往届通知和拿不准的不收', () => {
    expect(groups.get('evt-bim').notices.map(n => n.url)).toEqual(['https://s/1']);
    expect(groups.get('evt-ah').notices).toHaveLength(1);
    expect([...groups.values()].flatMap(g => g.notices).some(n => n.url === 'https://s/9')).toBe(false);
  });
  it('摘要里直接写出的网址单独取出来', () => {
    expect(groups.get('evt-bim').notices[0].urls).toEqual(['https://bim.example.org/2026']);
    expect(urlsInText('见 https://a.cn/x。另见https://b.cn/y，', 'https://a.cn/x')).toEqual(['https://b.cn/y']);
  });
  it('花搜索额度的只追溯未隔离的，已归档优先；隔离的只挂通知', () => {
    const targets = mentionSearchTargets(groups, 5);
    expect(targets.map(t => t.record.id)).toEqual(['r-bim-2025']);
    expect(primaryRecord(groups.get('evt-ah')).status).toBe('quarantined');
    const leads = noticeLeads(groups.get('evt-bim'));
    expect(leads.map(l => [l.url, l.source])).toEqual([['https://s/1', '抓取中提及'], ['https://bim.example.org/2026', '通知摘要']]);
  });
  it('额度为 0 时不搜索', () => {
    expect(mentionSearchTargets(groups, 0)).toEqual([]);
  });
});

describe('被拒网址记忆与线索排序', async () => {
  const { loadMemory, recentlyRejected, remember } = await import('../scripts/server/rejected-memory.mjs');
  const { pickLeads, leadRank } = await import('../scripts/server/trace-drafts.mjs');
  it('记住 30 天，网址写法不同也认得；过期自动忘', () => {
    const now = new Date('2026-09-29T00:00:00Z');
    const memory = remember({ urls:{} }, [{ url:'https://www.datafountain.cn/competitions/1085/', reason:'标题不是一场具体比赛' }], now);
    expect(recentlyRejected(memory, 'http://datafountain.cn/competitions/1085', now.getTime())).toBe(true);
    expect(recentlyRejected(memory, 'https://datafountain.cn/competitions/1086', now.getTime())).toBe(false);
    expect(recentlyRejected(memory, 'https://datafountain.cn/competitions/1085', now.getTime() + 31 * 86400000)).toBe(false);
    expect(loadMemory('/no/such/file.json')).toEqual({ urls:{} });
  });
  it('省级赛不会匹配到别的省；公众号百科不收；学校网站排在后面', () => {
    const record = { name:'辽宁省大学生BIM应用技能大赛', sources:[] };
    const leads = pickLeads([
      { url:'https://www.gxcme.edu.cn/a', title:'2026年广西大学生BIM应用技能大赛通知' },
      { url:'https://mp.weixin.qq.com/s/x', title:'辽宁省大学生BIM应用技能大赛报名通知' },
      { url:'https://cxcy.dlu.edu.cn/b', title:'关于第七届辽宁省大学生BIM应用技能大赛校内选拔赛的通知' },
      { url:'https://www.lnbim.org/c', title:'第七届辽宁省大学生BIM应用技能大赛通知' },
    ], record);
    expect(leads.map(lead => lead.url)).toEqual(['https://www.lnbim.org/c', 'https://cxcy.dlu.edu.cn/b']);
    expect(leadRank('https://baike.baidu.com/item/x')).toBe(9);
  });
});
