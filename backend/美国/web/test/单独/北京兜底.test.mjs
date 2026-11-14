// 北京兜底（2026-11-09 用户定）：美国读网页、取源码是网络问题读不到时（超时、网络错误、HTTP 403/405/5xx），改请北京代读一次（2026-11-13 加上 405）。
// 北京读到了就用北京的结果（加 经北京: true）；北京也读不到交回原来的失败结果，error 补一句“北京也没读到：…”。
// 成功、没更新、不支持的类型、robots 不允许、内网地址、404、正文太短等不改走北京。
// 另外：读网页、取源码 能把 超时、最大字节、最多跳转 传给下载（北京代读用 15 秒、3MB、5 次）。
import { describe, expect, test } from 'vitest';
import * as web from '../../index.mjs';
import { 带北京兜底, 是网络问题 } from '../../读网页/北京兜底.mjs';
import { 读网页 } from '../../读网页/index.mjs';
import { 取源码 } from '../../读网页/源码.mjs';

const 失败 = (status, error, extra = {}) => ({ url: 'https://a.cn/n', finalUrl: 'https://a.cn/n', status, httpStatus: null, contentType: '', title: '', text: '', links: [], error, ...extra });

function 准备({ 原, 北 }) {
  const 代读调用 = [];
  const 读们 = { 读网页: [], 取源码: [] };
  const 工具 = 带北京兜底({
    读网页: async (网址, 选项) => { 读们.读网页.push([网址, 选项]); return 原; },
    取源码: async (网址, 选项) => { 读们.取源码.push([网址, 选项]); return 原; },
    代读: async (网址, 选项) => { 代读调用.push([网址, 选项]); if (北 instanceof Error) throw 北; return 北; },
  });
  return { 工具, 代读调用, 读们 };
}

describe('哪些算网络问题', () => {
  test('超时、网络错误（含连接被重置、证书错误、域名解析失败）、HTTP 403、405 和 5xx 算', () => {
    expect(是网络问题(失败('超时', '超过 20 秒没下载完'))).toBe(true);
    expect(是网络问题(失败('网络错误', 'fetch failed（ECONNRESET）'))).toBe(true);
    expect(是网络问题(失败('网络错误', 'fetch failed（CERT_HAS_EXPIRED）'))).toBe(true);
    expect(是网络问题(失败('HTTP错误', '对方返回 403', { httpStatus: 403 }))).toBe(true);
    expect(是网络问题(失败('HTTP错误', '对方返回 502', { httpStatus: 502 }))).toBe(true);
    // 2026-11-13：“国际投资模拟仲裁大赛深圳杯”美国读返回 405，也改请北京
    expect(是网络问题(失败('HTTP错误', '对方返回 405', { httpStatus: 405 }))).toBe(true);
  });
  test('成功、没更新、404、跳转太多、太大、不支持、robots、内网、正文太短、读不出文字、内部错误不算', () => {
    for (const r of [
      失败('成功', ''), 失败('没更新', ''), 失败('HTTP错误', '对方返回 404', { httpStatus: 404 }), 失败('HTTP错误', '跳转超过 5 次', { httpStatus: 302 }),
      失败('太大', '超过'), 失败('不支持的类型', '不读'), 失败('robots不允许', 'robots'), 失败('网址不安全', '不读内网地址 10.0.0.1'),
      失败('正文太短', '空壳'), 失败('读不出文字', 'PDF'), 失败('内部错误', 'x'),
    ]) expect(是网络问题(r), `${r.status} ${r.error}`).toBe(false);
  });
});

describe('带北京兜底', () => {
  test('网络问题：改请北京代读，用北京的结果，标 经北京: true', async () => {
    const t = 准备({ 原: 失败('超时', '超过 20 秒没下载完'), 北: { ...失败('成功', ''), text: '北京读到的正文' } });
    const r = await t.工具.读网页('https://a.cn/n', { 最少字数: 100 });
    expect(r).toMatchObject({ status: '成功', text: '北京读到的正文', 经北京: true });
    expect(t.代读调用).toEqual([['https://a.cn/n', { 方式: '网页', signal: undefined }]]);
    expect(t.读们.读网页[0]).toEqual(['https://a.cn/n', { 最少字数: 100 }]);
  });
  test('取源码：带上 etag、最后修改请北京，北京回没更新也用北京的', async () => {
    const t = 准备({ 原: { url: 'https://a.cn/p', finalUrl: null, status: 'HTTP错误', httpStatus: 503, html: '', etag: null, 最后修改: null, error: '对方返回 503' },
      北: { url: 'https://a.cn/p', finalUrl: 'https://a.cn/p', status: '没更新', httpStatus: 304, html: '', etag: '"v1"', 最后修改: null, error: '' } });
    const 停 = new AbortController();
    const r = await t.工具.取源码('https://a.cn/p', { etag: '"v1"', 最后修改: 'Mon', signal: 停.signal });
    expect(r).toMatchObject({ status: '没更新', 经北京: true });
    expect(t.代读调用[0]).toEqual(['https://a.cn/p', { 方式: '源码', etag: '"v1"', 最后修改: 'Mon', signal: 停.signal }]);
  });
  test('北京给了确定的答复（404、正文太短、robots 不允许）也用北京的', async () => {
    const t = 准备({ 原: 失败('网络错误', 'fetch failed（ECONNRESET）'), 北: 失败('正文太短', '空壳页') });
    expect(await t.工具.读网页('https://a.cn/n')).toMatchObject({ status: '正文太短', 经北京: true });
  });
  test('北京也没读到：交回原来的失败结果，error 补“北京也没读到：…”', async () => {
    const t = 准备({ 原: 失败('超时', '超过 20 秒没下载完'), 北: 失败('网络错误', '北京代读失败：fetch failed') });
    const r = await t.工具.读网页('https://a.cn/n');
    expect(r.status).toBe('超时');
    expect(r.error).toBe('超过 20 秒没下载完；北京也没读到：北京代读失败：fetch failed');
    expect(r.经北京).toBeUndefined();
    const 也超时 = 准备({ 原: 失败('HTTP错误', '对方返回 403', { httpStatus: 403 }), 北: 失败('HTTP错误', '对方返回 403', { httpStatus: 403 }) });
    expect((await 也超时.工具.读网页('https://a.cn/n')).error).toBe('对方返回 403；北京也没读到：对方返回 403');
  });
  test('代读自己抛错也不往外抛，按北京没读到处理', async () => {
    const t = 准备({ 原: 失败('网络错误', 'fetch failed'), 北: new Error('炸了') });
    const r = await t.工具.读网页('https://a.cn/n');
    expect(r).toMatchObject({ status: '网络错误', error: 'fetch failed；北京也没读到：炸了' });
  });
  test('不是网络问题不请北京：成功、没更新、robots、内网、不支持、404', async () => {
    for (const 原 of [失败('成功', ''), 失败('没更新', ''), 失败('robots不允许', 'r'), 失败('网址不安全', '内网'), 失败('不支持的类型', 'x'), 失败('HTTP错误', '对方返回 404', { httpStatus: 404 })]) {
      const t = 准备({ 原, 北: 失败('成功', '') });
      expect(await t.工具.读网页('https://a.cn/n')).toBe(原);
      expect(await t.工具.取源码('https://a.cn/n')).toBe(原);
      expect(t.代读调用).toEqual([]);
    }
  });
  test('调用方已经喊停（signal 已中止）：不请北京', async () => {
    const 停 = new AbortController();
    停.abort();
    const t = 准备({ 原: 失败('网络错误', 'aborted'), 北: 失败('成功', '') });
    expect((await t.工具.读网页('https://a.cn/n', { signal: 停.signal })).status).toBe('网络错误');
    expect(t.代读调用).toEqual([]);
  });
  test('入口导出 带北京兜底 和 代读（新维护只能经 web 入口拿）', () => {
    expect(typeof web.带北京兜底).toBe('function');
    expect(typeof web.代读).toBe('function');
  });
});

describe('读网页、取源码 传上限给下载', () => {
  const 选项 = fetchImpl => ({ fetchImpl, 限速: { 等候: async () => {} }, 安全检查: async () => null, robots: async () => true });
  const 大响应 = async () => new Response('x'.repeat(50), { status: 200, headers: { 'content-type': 'text/html' } });
  test('最大字节', async () => {
    expect((await 读网页('https://a.cn/n', { ...选项(大响应), 最大字节: 10 })).status).toBe('太大');
    expect((await 取源码('https://a.cn/n', { ...选项(大响应), 最大字节: 10 })).status).toBe('太大');
  });
  test('最多跳转', async () => {
    let i = 0;
    const 绕圈 = async () => new Response(null, { status: 302, headers: { location: `/${(i += 1)}` } });
    const r = await 读网页('https://a.cn/0', { ...选项(绕圈), 最多跳转: 1 });
    expect(r).toMatchObject({ status: 'HTTP错误', error: '跳转超过 1 次' });
  });
  test('超时', async () => {
    const 慢 = (_, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    expect((await 取源码('https://a.cn/n', { ...选项(慢), 超时: 20 })).status).toBe('超时');
  });
});
