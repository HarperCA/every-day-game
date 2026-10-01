// 通知追溯第一种办法：直接访问通知页面，提取页面里写出的官网、报名网址
import { describe, expect, it } from 'vitest';
import { linksFromNoticePage } from '../scripts/server/notice-page-links.mjs';

const PAGE = `<html><body>
  <div class="nav"><a href="/index.htm">首页</a><a href="https://jwc.example.edu.cn/list.htm">通知公告</a><a href="https://cs.example.edu.cn/">计算机学院</a></div>
  <div class="content">
    <p>关于组织参加第十一届全国大学生生命科学竞赛的通知</p>
    <p>报名网址：https://www.culsc.cn/#/ ，请于 10 月 15 日前完成注册。</p>
    <p>详见<a href="https://www.culsc.cn/notice/123">大赛官网通知</a>；报名系统：<a href="http://bm.culsc.cn/login">点此报名</a></p>
    <p>附件：<a href="/upload/竞赛章程.pdf">竞赛章程.pdf</a> <a href="https://mp.weixin.qq.com/s?__biz=abc">大赛公众号</a></p>
    <p><a href="https://www.example.com/news/1">学校新闻</a></p>
  </div></body></html>`;

describe('从通知页面提取网址', () => {
  const links = linksFromNoticePage(PAGE, 'https://jwc.example.edu.cn/info/1001.htm');
  const urls = links.map(link => link.url);
  it('正文里直接写出的网址排在最前面', () => {
    expect(links[0]).toMatchObject({ url:'https://www.culsc.cn/#/', from:'text' });
  });
  it('链接文字带“官网、报名”的外站链接也要', () => {
    expect(urls).toContain('https://www.culsc.cn/notice/123');
    expect(urls).toContain('http://bm.culsc.cn/login');
    expect(links.find(link => link.url === 'http://bm.culsc.cn/login').label).toBe('点此报名');
  });
  it('同一个学校网站的导航和栏目（含其他学院子域名）、附件、公众号、无关链接都不要', () => {
    expect(urls.some(url => /example\.edu\.cn/.test(url))).toBe(false);
    expect(urls.some(url => /\.pdf/.test(url))).toBe(false);
    expect(urls.some(url => /weixin/.test(url))).toBe(false);
    expect(urls).not.toContain('https://www.example.com/news/1');
  });
  it('非 edu.cn 的学校网站，其他部门子域名也算同一个网站；“网络教学平台”这类链接不要', () => {
    const page = '<a href="http://jwc.wuit.cn/wlkc.htm">网络教学平台</a><a href="http://www.other.org/">网络教学平台</a><a href="http://sd.structurecontest.com/home">大赛官网</a>';
    expect(linksFromNoticePage(page, 'https://www.wuit.cn/info/1.htm').map(link => link.url)).toEqual(['http://sd.structurecontest.com/home']);
  });
  it('最多 5 个，重复的只留一个', () => {
    const many = Array.from({ length:8 }, (_, i) => `<a href="https://site${i}.org/">大赛官网${i}</a><a href="https://site${i}.org/">大赛官网${i}</a>`).join('');
    const result = linksFromNoticePage(many, 'https://jwc.example.edu.cn/a.htm');
    expect(result).toHaveLength(5);
    expect(new Set(result.map(link => link.url)).size).toBe(5);
  });
  it('空页面不报错', () => {
    expect(linksFromNoticePage('', 'https://a.edu.cn/')).toEqual([]);
  });
});
