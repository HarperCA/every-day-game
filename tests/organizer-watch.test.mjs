import { describe, expect, it } from 'vitest';
import { diffPage, extractLinks, isContestNotice, matchRecord, parentListing, watchPages } from '../scripts/server/organizer-watch.mjs';

const now = new Date('2026-09-25T02:00:00+08:00');

describe('主办方公告栏监测', () => {
  it('从已核验来源得出监测页：官网本身、通知所在栏目；跳过公众号等转载站', () => {
    const records = [
      { id:'a', name:'湖南省大学生统计建模大赛', dataStatus:'archived', sources:[
        { url:'http://jyt.hunan.gov.cn/tzgg/2026-03/abc.html', source_type:'authority_notice', is_official:true, validity_status:'valid' },
        { url:'https://contest.org/', source_type:'organizer_website', is_official:true, validity_status:'valid' },
        { url:'https://mp.weixin.qq.com/s/x', source_type:'organizer_website', is_official:true, validity_status:'valid' },
      ] },
      { id:'b', name:'隔离赛事', dataStatus:'quarantined', sources:[{ url:'https://q.org/', source_type:'organizer_website', is_official:true, validity_status:'valid' }] },
    ];
    expect(watchPages(records).map(p => [p.url, p.kind])).toEqual([['http://jyt.hunan.gov.cn/tzgg/2026-03/', 'listing'], ['https://contest.org/', 'site']]);
    expect(parentListing('https://host.cn/a.html')).toBeNull();
  });

  it('抽取链接：相对地址转绝对，优先较长的 title 属性，去掉脚本链接', () => {
    const html = '<a href="/tz/1.html" title="关于举办2026年湖南省大学生统计建模大赛的通知">关于举办2026年…</a><a href="javascript:void(0)">x</a><a href="2.html"><span>学院新闻</span></a>';
    expect(extractLinks(html, 'http://jyt.hunan.gov.cn/tzgg/')).toEqual([
      { url:'http://jyt.hunan.gov.cn/tz/1.html', title:'关于举办2026年湖南省大学生统计建模大赛的通知' },
      { url:'http://jyt.hunan.gov.cn/tzgg/2.html', title:'学院新闻' },
    ]);
    expect(isContestNotice('学院新闻')).toBe(false);
    expect(isContestNotice('关于举办第十届测试大赛的通知')).toBe(true);
  });

  it('第一次看到某页只收当年或下一年的通知；之后只报新链接；已有来源不算', () => {
    const page = { records:[{ id:'a', name:'湖南省大学生统计建模大赛' }] };
    const links = [
      { url:'u1', title:'关于举办2026年湖南省大学生统计建模大赛的通知' },
      { url:'u2', title:'关于举办2024年湖南省大学生统计建模大赛的通知' },
      { url:'u3', title:'关于举办2026年湖南省大学生物理竞赛的通知' },
      { url:'u4', title:'关于举办2026年湖南省大学生数学竞赛的通知' },
    ];
    const first = diffPage(page, links, undefined, now, new Set(['u4']));
    expect(first.fresh.map(f => [f.url, f.record?.id || null])).toEqual([['u1', 'a'], ['u3', null]]);
    const second = diffPage(page, [...links, { url:'u5', title:'2027年湖南省大学生统计建模大赛报名通知' }], { seen:first.seen }, now);
    expect(second.fresh.map(f => f.url)).toEqual(['u5']);
    const viaLibrary = diffPage(page, [links[2]], undefined, now, new Set(), [{ id:'p', name:'湖南省大学生物理竞赛' }]);
    expect(viaLibrary.fresh[0].record.id).toBe('p');
  });

  it('按赛事名主体匹配，省份前缀与年份届次不影响', () => {
    expect(matchRecord('第十届湖南省大学生统计建模大赛报名通知', [{ id:'a', name:'湖南省大学生统计建模大赛' }])?.id).toBe('a');
    expect(matchRecord('湖南省大学生物理竞赛通知', [{ id:'a', name:'湖南省大学生统计建模大赛' }])).toBeNull();
  });
});
