// 抓网页：只有一个总函数 读网页，按顺序调 下载、编码、正文、pdf、word 这几块；各块只提供函数。
// 不连网：下载换成假的 fetch，robots.txt、网页、PDF、Word 都在测试里现做。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import * as web from '../../index.mjs';
import { 读网页, 内容类型 } from '../../读网页/index.mjs';
import { checkResult, isRetryable, STATUSES } from '../../读网页/结果.mjs';
import { normalizeUrl } from '../../读网页/网址.mjs';
import { checkUrlSafety } from '../../读网页/安全.mjs';
import { 建限速 } from '../../读网页/限速.mjs';
import { 下载 } from '../../下载/index.mjs';
import { robots允许, 规则允许, 建robots检查 } from '../../下载/robots.mjs';
import { 识别编码, 转文字 } from '../../编码/index.mjs';
import { 取网页 } from '../../正文/index.mjs';
import { PDF文字 } from '../../pdf/index.mjs';
import { Word文字 } from '../../word/index.mjs';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const iconv = createRequire(path.join(WEB, '../../Environment/package.json'))('iconv-lite');

// 假的 fetch：按网址交回准备好的响应
function 假fetch(表) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push(url);
    const r = typeof 表[url] === 'function' ? 表[url](init) : 表[url];
    if (!r) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
    if (r instanceof Error) throw r;
    return new Response(r.body ?? '', { status: r.status ?? 200, headers: r.headers ?? { 'content-type': 'text/html; charset=utf-8' } });
  };
  fn.calls = calls;
  return fn;
}
const 长正文 = '第十届全国大学生某某竞赛由中国某某学会主办，面向全国普通高校在校本科生和研究生，报名截止 2026 年 12 月 1 日。'.repeat(6);
const 网页 = (body, title = '大赛通知') => `<html><head><title>${title}</title></head><body><nav>首页 登录 注册 通知公告</nav><article><h1>${title}</h1><p>${body}</p></article><footer>版权所有</footer></body></html>`;

// 现做一个只存不压的 docx（zip 包里放 word/document.xml）
function 做docx(xml) {
  const name = Buffer.from('word/document.xml');
  const data = Buffer.from(xml);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(0, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0, 10); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
  const centralStart = local.length + name.length + data.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(centralStart, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}
// 现做一个最小的 PDF，里面一行英文
function 做pdf(text) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const stream = `BT /F1 12 Tf 10 50 Td (${text}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

describe('网址和安全（读网页里）', () => {
  test('只去掉跟踪参数，带签名的网址原样保留', () => {
    expect(normalizeUrl('https://a.cn/x?utm_source=1&id=2#top')).toBe('https://a.cn/x?id=2');
    expect(normalizeUrl('https://a.cn/x?utm_source=1&signature=abc')).toBe('https://a.cn/x?utm_source=1&signature=abc');
  });
  test('内网、本机地址一律拒绝，公网放行', async () => {
    expect(await checkUrlSafety('http://127.0.0.1/a')).toContain('内网');
    expect(await checkUrlSafety('http://localhost/a')).toContain('本机');
    expect(await checkUrlSafety('https://a.cn/', { lookup: async () => [{ address: '10.0.0.3' }] })).toContain('内网');
    expect(await checkUrlSafety('https://a.cn/', { lookup: async () => [{ address: '1.2.3.4' }] })).toBeNull();
  });
});

describe('下载', () => {
  test('robots 规则：最长匹配优先，同样长 Allow 胜出，空 Disallow 不限制', () => {
    const txt = 'User-agent: *\nDisallow: /admin\nAllow: /admin/public\nDisallow:\n';
    expect(规则允许(txt, '/admin/x')).toBe(false);
    expect(规则允许(txt, '/admin/public/a')).toBe(true);
    expect(规则允许(txt, '/news')).toBe(true);
    expect(规则允许('User-agent: *\nDisallow: /\n', '/a')).toBe(false);
  });
  test('robots.txt 每个网站只取一次；取不到、或者交回的是网页（首页兜底），按惯例算允许', async () => {
    const fetchImpl = 假fetch({ 'https://a.cn/robots.txt': { body: 'User-agent: *\nDisallow: /private', headers: { 'content-type': 'text/plain' } }, 'https://b.cn/robots.txt': { body: '<html>首页</html>' } });
    const 检查 = 建robots检查({ fetchImpl });
    expect(await 检查('https://a.cn/private/1')).toBe(false);
    expect(await 检查('https://a.cn/ok')).toBe(true);
    expect(await 检查('https://b.cn/private/1')).toBe(true);
    expect(await 检查('https://c.cn/x')).toBe(true);
    expect(fetchImpl.calls.filter(u => u.startsWith('https://a.cn'))).toEqual(['https://a.cn/robots.txt']);
    expect(typeof robots允许).toBe('function');
  });
  test('下载成功：交回最终网址、状态码、类型和原始内容', async () => {
    const r = await 下载('https://a.cn/n', { fetchImpl: 假fetch({ 'https://a.cn/n': { body: 'hi' } }) });
    expect(r).toMatchObject({ finalUrl: 'https://a.cn/n', httpStatus: 200, contentType: 'text/html; charset=utf-8' });
    expect(r.body.toString()).toBe('hi');
  });
  test('跳转：每一跳之前都调检查函数（安全、robots），不通过就停；超过 5 跳报错', async () => {
    const fetchImpl = 假fetch({ 'https://a.cn/1': { status: 302, headers: { location: '/2' } }, 'https://a.cn/2': { body: 'ok' } });
    const 查过 = [];
    const r = await 下载('https://a.cn/1', { fetchImpl, 跳转前检查: async u => { 查过.push(u); return null; } });
    expect(r.finalUrl).toBe('https://a.cn/2');
    expect(查过).toEqual(['https://a.cn/2']);
    await expect(下载('https://a.cn/1', { fetchImpl, 跳转前检查: async () => 'robots 不允许' })).rejects.toMatchObject({ kind: '网址不安全' });
    const 绕圈 = 假fetch(Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`https://a.cn/${i}`, { status: 301, headers: { location: `/${i + 1}` } }])));
    await expect(下载('https://a.cn/0', { fetchImpl: 绕圈 })).rejects.toThrow('跳转');
  });
  test.each([
    ['对方 404', { status: 404 }, 'HTTP错误'],
    ['太大', { body: 'x'.repeat(50), headers: { 'content-type': 'text/html' } }, '太大'],
    ['不收的类型', { body: 'x', headers: { 'content-type': 'image/png' } }, '不支持的类型'],
    ['超时', Object.assign(new Error('timeout'), { name: 'TimeoutError' }), '超时'],
    ['连不上', new TypeError('fetch failed'), '网络错误'],
  ])('%s：抛出带 kind 的错误', async (_, 响应, kind) => {
    await expect(下载('https://a.cn/x', { fetchImpl: 假fetch({ 'https://a.cn/x': 响应 }), 最大字节: 10 })).rejects.toMatchObject({ kind });
  });
});

describe('编码', () => {
  test('先看响应头，再看网页里的 meta；gb2312 按 gbk 读；都没写按 utf-8', () => {
    expect(识别编码('text/html; charset=GBK', Buffer.from(''))).toBe('gbk');
    expect(识别编码('text/html', Buffer.from('<meta charset="gb2312">'))).toBe('gbk');
    expect(识别编码('text/html', Buffer.from('<meta http-equiv="Content-Type" content="text/html; charset=utf-8">'))).toBe('utf-8');
    expect(识别编码('text/html', Buffer.from('<p>x</p>'))).toBe('utf-8');
  });
  test('GBK 的网页转成正常文字，不乱码', () => {
    expect(转文字(iconv.encode('全国大学生竞赛', 'gbk'), 'text/html; charset=gbk')).toBe('全国大学生竞赛');
  });
});

describe('正文', () => {
  test('去掉导航、页脚，取正文容器；标题先取 h1', () => {
    const r = 取网页(网页(长正文, '第十届某某竞赛通知'), 'https://a.cn/n');
    expect(r.标题).toBe('第十届某某竞赛通知');
    expect(r.正文).toContain('中国某某学会主办');
    expect(r.正文).not.toContain('登录');
    expect(r.正文).not.toContain('版权所有');
  });
  test('网页代码压成一行时，段落、标题、列表、表格行、换行标签之间照样分行（2026-11-02：数维杯的通知原来并成了一行）', () => {
    const 压缩 = '<html><body><div class="content"><h2>关于举办2026年数维杯的通知</h2><p>各高等院校：</p><p>一、主办单位：某某学会</p>'
      + '<p>二、参赛对象：全日制在校大学生<br>三、竞赛形式：三人一队</p><ul><li>报名截止时间：2026年10月15日</li><li>报名方式：网上报名</li></ul>'
      + '<table><tr><td>主办单位</td><td>某某学会</td></tr><tr><td>承办单位</td><td>某某大学</td></tr></table>'
      + `<p>${'数维杯全国大学生数学建模挑战赛自2015年创办以来已成功举办十一届。'.repeat(6)}</p></div></body></html>`;
    const 行们 = 取网页(压缩, 'https://a.cn/n').正文.split('\n');
    expect(行们.slice(0, 9)).toEqual(['关于举办2026年数维杯的通知', '各高等院校：', '一、主办单位：某某学会', '二、参赛对象：全日制在校大学生',
      '三、竞赛形式：三人一队', '报名截止时间：2026年10月15日', '报名方式：网上报名', '主办单位 某某学会', '承办单位 某某大学']);
  });
  test('链接：只要同站的，去掉“首页、更多”这类，分成通知、附件、报名入口、其他，像通知的排前面', () => {
    const html = `<body><a href="/">首页</a><a href="/list">更多</a><a href="https://other.com/x">别的网站的通知</a>
      <a href="/files/章程.pdf">大赛章程</a><a href="https://reg.a.cn/signup">报名系统</a><a href="/news/20261001/12345.html">关于举办第十届大赛的通知</a><a href="/about">关于我们</a></body>`;
    const { 链接们 } = 取网页(html, 'https://www.a.cn/');
    expect(链接们.map(l => [l.text, l.kind])).toEqual([['关于举办第十届大赛的通知', '通知'], ['大赛章程', '附件'], ['报名系统', '报名入口'], ['关于我们', '其他']]);
    expect(链接们[1].url).toBe('https://www.a.cn/files/%E7%AB%A0%E7%A8%8B.pdf');
  });
});

describe('pdf 和 word', () => {
  test('PDF 读出文字；坏文件抛错', async () => {
    expect(await PDF文字(做pdf('Competition 2026 notice'))).toContain('Competition 2026 notice');
    await expect(PDF文字(Buffer.from('%PDF-1.4 坏了'))).rejects.toThrow();
  });
  test('Word（docx）读出文字，段落分行；不是 docx 抛错', () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>第十届大赛</w:t></w:r></w:p><w:p><w:r><w:t>报名&amp;参赛</w:t></w:r></w:p></w:body></w:document>';
    expect(Word文字(做docx(xml))).toBe('第十届大赛\n报名&参赛');
    expect(() => Word文字(Buffer.from('不是 zip'))).toThrow('docx');
  });
});

describe('读网页（总函数）', () => {
  const 无限速 = 建限速({ 间隔: 0 });
  const 安全 = async () => null;
  const 选项 = (表, extra = {}) => ({ fetchImpl: 假fetch(表), 限速: 无限速, 安全检查: 安全, ...extra });

  test('网页：下载 → 编码 → 正文，一路走通交回“成功”，结果过得了格式检查', async () => {
    const html = iconv.encode(网页(长正文), 'gbk');
    const r = await 读网页('https://a.cn/n?utm_source=x', 选项({ 'https://a.cn/n': { body: html, headers: { 'content-type': 'text/html; charset=gbk' } } }));
    expect(r).toMatchObject({ url: 'https://a.cn/n', status: '成功', title: '大赛通知', httpStatus: 200 });
    expect(r.text).toContain('中国某某学会主办');
    expect(checkResult(r)).toEqual([]);
  });
  test('PDF、Word 按文件内容判断（标成 text/html 的 PDF 也按 PDF 读）', async () => {
    expect(内容类型('text/html', 做pdf('x'), 'https://a.cn/a')).toBe('pdf');
    expect(内容类型('application/octet-stream', 做docx('<w:p/>'), 'https://a.cn/a.docx')).toBe('docx');
    const r = await 读网页('https://a.cn/f', 选项({ 'https://a.cn/f': { body: 做pdf('Competition 2026 notice '.repeat(20)), headers: { 'content-type': 'application/pdf' } } }));
    expect(r.status).toBe('成功');
    expect(r.text).toContain('Competition 2026');
  });
  test('robots 不允许：不下载，交回 robots不允许', async () => {
    const fetchImpl = 假fetch({ 'https://a.cn/robots.txt': { body: 'User-agent: *\nDisallow: /', headers: { 'content-type': 'text/plain' } } });
    const r = await 读网页('https://a.cn/n', { fetchImpl, 限速: 无限速, 安全检查: 安全 });
    expect(r.status).toBe('robots不允许');
    expect(fetchImpl.calls).toEqual(['https://a.cn/robots.txt']);
  });
  test('每一步失败都有对应的状态和原因，不抛错', async () => {
    expect((await 读网页('ftp://a.cn/x', 选项({}))).status).toBe('网址不安全');
    expect((await 读网页('https://a.cn/x', { ...选项({}), 安全检查: async () => '不读内网地址' })).status).toBe('网址不安全');
    expect((await 读网页('https://a.cn/x', 选项({ 'https://a.cn/x': { status: 500 } })))).toMatchObject({ status: 'HTTP错误', httpStatus: 500 });
    expect((await 读网页('https://a.cn/x', 选项({ 'https://a.cn/x': new TypeError('fetch failed') }))).status).toBe('网络错误');
    expect((await 读网页('https://a.cn/x', 选项({ 'https://a.cn/x': { body: 'x', headers: { 'content-type': 'image/png' } } }))).status).toBe('不支持的类型');
    expect((await 读网页('https://a.cn/x', 选项({ 'https://a.cn/x': { body: '%PDF-1.4 坏了', headers: { 'content-type': 'application/pdf' } } }))).status).toBe('读不出文字');
    const 空壳 = await 读网页('https://a.cn/x', 选项({ 'https://a.cn/x': { body: 网页('加载中') } }));
    expect(空壳).toMatchObject({ status: '正文太短', text: expect.stringContaining('加载中') });
    for (const s of ['网络错误', '超时']) expect(isRetryable({ status: s })).toBe(true);
    expect(isRetryable({ status: 'robots不允许' })).toBe(false);
    expect(STATUSES).toContain('读不出文字');
  });
  test('同一网站两次读取之间至少隔开设定的间隔，不同网站不用等', async () => {
    const 限速 = 建限速({ 间隔: 80 });
    const 表 = { 'https://a.cn/1': { body: 网页(长正文) }, 'https://a.cn/2': { body: 网页(长正文) }, 'https://b.cn/1': { body: 网页(长正文) } };
    const fetchImpl = 假fetch(表);
    const 时刻 = {};
    const 读 = async u => { await 读网页(u, { fetchImpl, 限速, 安全检查: 安全, robots: async () => true }); 时刻[u] = Date.now(); };
    const t0 = Date.now();
    await Promise.all(['https://a.cn/1', 'https://a.cn/2', 'https://b.cn/1'].map(读));
    expect(时刻['https://a.cn/2'] - t0).toBeGreaterThanOrEqual(75);
    expect(时刻['https://b.cn/1'] - t0).toBeLessThan(75);
  });
});

describe('入口和结构', () => {
  test('入口只给 读网页（外加网址规范化、结果的状态和检查）', () => {
    expect(Object.keys(web).sort()).toEqual(['LINK_KINDS', 'MIN_TEXT_CHARS', 'STATUSES', 'checkResult', 'isRetryable', 'normalizeUrl', '读网页'].sort());
  });
  test('文件夹：读网页（总函数）、下载、编码、正文、pdf、word、test，各有 README', () => {
    const dirs = fs.readdirSync(WEB, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
    expect(dirs).toEqual(['pdf', 'test', 'word', '下载', '正文', '编码', '读网页'].sort());
    for (const d of dirs.filter(d => d !== 'test')) expect(fs.existsSync(path.join(WEB, d, 'README.md')), d).toBe(true);
  });
  test('引用规矩：只有 读网页 调其他几块；其他几块互不引用，只用自己的文件、Environment 里的库和 共用/工具', () => {
    const 块们 = ['下载', '编码', '正文', 'pdf', 'word'];
    const 问题 = [];
    for (const 块 of 块们) {
      for (const f of fs.readdirSync(path.join(WEB, 块)).filter(f => f.endsWith('.mjs'))) {
        const src = fs.readFileSync(path.join(WEB, 块, f), 'utf8');
        for (const m of src.matchAll(/from\s+'(\.[^']+)'/g)) {
          const to = path.relative(WEB, path.resolve(WEB, 块, m[1])).replace(/\\/g, '/');
          if (!to.startsWith(`${块}/`) && !to.startsWith('../../共用/工具/')) 问题.push(`${块}/${f} 引用了 ${to}`);
        }
      }
    }
    expect(问题).toEqual([]);
  });
});
