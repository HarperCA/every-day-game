import { describe, expect, it } from 'vitest';
import { extractText, extractTitle, findNoticeLinks, normalizeWhitespace } from '../scripts/crawler/lib/extract.mjs';
import { decodeBody, detectCharset } from '../scripts/crawler/lib/fetcher.mjs';
import iconv from '../scripts/crawler/node_modules/iconv-lite/lib/index.js';

describe('正文提取', () => {
  it('丢掉导航、页头页脚，只留正文', () => {
    const html = `
      <html><body>
        <nav>首页 登录 注册 通知公告 比赛入口</nav>
        <header>某某大赛官网</header>
        <article>${'报名截止时间为2026年9月25日12时。'.repeat(20)}</article>
        <footer>版权所有</footer>
        <script>tracker()</script>
      </body></html>`;
    const text = extractText(html);
    expect(text).toContain('报名截止时间为2026年9月25日12时');
    expect(text).not.toContain('登录 注册');
    expect(text).not.toContain('版权所有');
    expect(text).not.toContain('tracker');
  });

  it('正文容器太短时退回整页，避免选错容器丢内容', () => {
    const html = '<body><main>短</main><div>' + '正文内容。'.repeat(50) + '</div></body>';
    expect(extractText(html).length).toBeGreaterThan(100);
  });

  it('截断到上限', () => {
    const html = `<body><article>${'字'.repeat(500)}</article></body>`;
    expect(extractText(html, { maxChars: 100 })).toHaveLength(100);
  });

  it('标题优先取 h1，其次 title', () => {
    expect(extractTitle('<title>站点</title><h1>关于举办第十九届大赛的通知</h1>')).toBe('关于举办第十九届大赛的通知');
    expect(extractTitle('<title>只有标题</title>')).toBe('只有标题');
  });
});

describe('通知链接发现', () => {
  const base = 'https://example.edu.cn/list.html';

  it('通知类链接排在导航链接前面', () => {
    const html = `
      <a href="/">首页</a>
      <a href="/about">关于我们</a>
      <a href="/notice/t20260731_123456.html">关于举办2026年竞赛的通知</a>`;
    const links = findNoticeLinks(html, base);
    expect(links[0].url).toContain('t20260731_123456.html');
    expect(links.map(l => l.text)).not.toContain('首页');
  });

  it('PDF 附件会被识别并加权', () => {
    const html = '<a href="/files/2026notice.pdf">竞赛章程附件</a>';
    const links = findNoticeLinks(html, base);
    expect(links[0].isPdf).toBe(true);
  });

  it('不跟进站外链接', () => {
    const html = '<a href="https://other-site.com/notice">报名通知</a>';
    expect(findNoticeLinks(html, base)).toEqual([]);
  });

  it('跟进同主域的子站', () => {
    const html = '<a href="https://jw.example.edu.cn/notice/12345.html">报名通知</a>';
    expect(findNoticeLinks(html, base)).toHaveLength(1);
  });

  it('忽略 javascript 和锚点链接', () => {
    const html = '<a href="javascript:void(0)">报名通知</a><a href="#top">报名通知</a>';
    expect(findNoticeLinks(html, base)).toEqual([]);
  });
});

describe('编码识别', () => {
  it('优先用 content-type 里的 charset', () => {
    expect(detectCharset('text/html; charset=GBK', Buffer.from(''))).toBe('gbk');
  });

  it('没有响应头时嗅探 meta charset', () => {
    expect(detectCharset('text/html', Buffer.from('<meta charset="gb2312">'))).toBe('gb2312');
    expect(detectCharset('', Buffer.from('<html>无声明</html>'))).toBe('utf-8');
  });

  it('正确解码 GBK 中文，不再整页乱码', () => {
    // 国内高校和政府站点大量使用 GB2312/GBK，写死 UTF-8 会全是乱码
    const original = '关于举办全国大学生竞赛的通知';
    const gbk = iconv.encode(original, 'gbk');
    expect(decodeBody(gbk, 'gb2312')).toBe(original);
    expect(decodeBody(gbk, 'gbk')).toBe(original);
    expect(decodeBody(gbk, 'utf-8')).not.toBe(original);
  });

  it('遇到未知编码退回 UTF-8 而不是抛错', () => {
    expect(decodeBody(Buffer.from('ok'), 'not-a-real-charset')).toBe('ok');
  });
});

describe('空白归一', () => {
  it('压缩多余空白但保留段落', () => {
    expect(normalizeWhitespace('a  b\n\n\n\nc')).toBe('a b\n\nc');
  });
});

describe('图片发现', () => {
  const base = 'https://example.edu.cn/notice/123.html';

  it('收集正文里的大图并按信息量排序', async () => {
    const { findImages } = await import('../scripts/crawler/lib/extract.mjs');
    const html = `
      <img src="/img/logo.png" alt="校徽">
      <img src="/upload/flow.jpg" alt="2026年报名流程图" width="800" height="600">
      <img src="/upload/photo.jpg" width="640" height="480">`;
    const images = findImages(html, base);
    expect(images[0].alt).toBe('2026年报名流程图');
    expect(images.map(i => i.url)).not.toContain('https://example.edu.cn/img/logo.png');
  });

  it('滤掉图标、二维码、分享按钮这类无信息量的图', async () => {
    const { findImages } = await import('../scripts/crawler/lib/extract.mjs');
    const html = `
      <img src="/static/icon-share.png" width="800" height="600">
      <img src="/static/qrcode.png" width="800" height="600">
      <img src="/static/weixin.gif" width="800" height="600">`;
    expect(findImages(html, base)).toEqual([]);
  });

  it('滤掉尺寸过小的图', async () => {
    const { findImages } = await import('../scripts/crawler/lib/extract.mjs');
    const html = '<img src="/upload/small.png" alt="装饰" width="60" height="60">';
    expect(findImages(html, base)).toEqual([]);
  });

  it('不收集导航和页脚里的图', async () => {
    const { findImages } = await import('../scripts/crawler/lib/extract.mjs');
    const html = '<header><img src="/upload/head.jpg" width="900" height="300"></header>';
    expect(findImages(html, base)).toEqual([]);
  });

  it('支持懒加载属性', async () => {
    const { findImages } = await import('../scripts/crawler/lib/extract.mjs');
    const html = '<img data-src="/upload/lazy.jpg" alt="赛程安排表" width="800" height="600">';
    expect(findImages(html, base)[0].url).toBe('https://example.edu.cn/upload/lazy.jpg');
  });
});
