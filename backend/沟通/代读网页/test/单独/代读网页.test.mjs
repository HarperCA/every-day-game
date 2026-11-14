// 代读网页（美国 → 北京 → 国内网站，2026-11-09）：美国维护读不到网页是网络问题时，请北京代读，读完交回美国。
// 北京端验签（和公开比赛同步同一套 HMAC + 5 分钟时效），用 美国/web 同一份 读网页、取源码（同一套安全检查、robots、爬虫身份），上限 15 秒、3MB、5 次跳转。
// 美国端签名请求北京，交回和 读网页 / 取源码 一样的格式；北京出错或连不上时交回“网络错误”，不抛。
// 不连网：北京端的读网页换成带假 fetch 的真 读网页，美国端的 fetch 直接转给北京端的 接收。
import { describe, expect, test } from 'vitest';
import { 读网页 as 真读网页, 取源码 as 真取源码, checkResult } from '../../../../美国/web/index.mjs';
import { 签名, 时间头, 签名头 } from '../../../公开比赛同步/格式.mjs';
import { 接收, 建服务, 上限, 路径 } from '../../北京端.mjs';
import { 代读 } from '../../美国端.mjs';

const 秘钥 = 'k'.repeat(40);
const 无限速 = { 等候: async () => {} };
const 长正文 = '第十届全国大学生某某竞赛由中国某某学会主办，面向全国普通高校在校本科生和研究生，报名截止 2026 年 12 月 1 日。'.repeat(6);
const 网页 = `<html><head><title>大赛通知</title></head><body><article><h1>大赛通知</h1><p>${长正文}</p></article></body></html>`;

function 假fetch(表) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    const r = typeof 表[url] === 'function' ? 表[url](init) : 表[url];
    if (!r) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
    if (r instanceof Error) throw r;
    const 无正文 = [204, 304].includes(r.status);
    return new Response(无正文 ? null : (r.body ?? ''), { status: r.status ?? 200, headers: r.headers ?? { 'content-type': 'text/html; charset=utf-8' } });
  };
  fn.calls = calls;
  return fn;
}

// 北京那边“真的读”：真 读网页 / 取源码，只把网络换成假的（安全检查用默认的那份，robots 放行）
function 北京读者(表) {
  const fetchImpl = 假fetch(表);
  const 收到的选项 = [];
  const 换 = 读 => (网址, 选项 = {}) => { 收到的选项.push(选项); return 读(网址, { ...选项, fetchImpl, 限速: 无限速, robots: async () => true }); };
  return { 读网页: 换(真读网页), 取源码: 换(真取源码), fetchImpl, 收到的选项 };
}

// 美国端的 fetch 直接转给北京端的 接收（不起服务器）
function 转给北京(环境) {
  const 发过 = [];
  const fn = async (地址, init) => {
    const 头 = Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v]));
    发过.push({ 地址, 头, 正文: init.body });
    const { 状态, 内容 } = await 接收({ 方法: init.method, 头, 正文: init.body }, { 秘钥, ...环境, now: new Date(Number(头[时间头])) });
    return { ok: 状态 < 300, status: 状态, json: async () => 内容 };
  };
  fn.发过 = 发过;
  return fn;
}

const 发 = (请求, 环境 = {}, { 时间 = Date.now(), 用的秘钥 = 秘钥, 方法 = 'POST' } = {}) => {
  const 正文 = typeof 请求 === 'string' ? 请求 : JSON.stringify(请求);
  return 接收({ 方法, 头: { [时间头]: String(时间), [签名头]: 签名(用的秘钥, String(时间), 正文) }, 正文 }, { 秘钥, now: new Date(), ...环境 });
};

describe('北京端', () => {
  test('上限：15 秒、3MB、5 次跳转；路径 /sync/fetch', () => {
    expect(上限).toEqual({ 超时: 15000, 最大字节: 3 * 1024 * 1024, 最多跳转: 5 });
    expect(路径).toBe('/sync/fetch');
  });
  test('方式“网页”：用读网页读，交回读网页的统一结果；上限传给读网页', async () => {
    const 北京 = 北京读者({ 'https://a.cn/n': { body: 网页 } });
    const { 状态, 内容 } = await 发({ 网址: 'https://a.cn/n', 方式: '网页' }, 北京);
    expect(状态).toBe(200);
    expect(内容.ok).toBe(true);
    expect(checkResult(内容.结果)).toEqual([]);
    expect(内容.结果).toMatchObject({ status: '成功', title: '大赛通知', finalUrl: 'https://a.cn/n' });
    expect(北京.收到的选项[0]).toMatchObject(上限);
  });
  test('方式“源码”：用取源码读，带上 etag、最后修改；网站回 304 交回“没更新”', async () => {
    const 北京 = 北京读者({ 'https://a.cn/p': init => (init.headers['if-none-match'] === '"v1"' ? { status: 304, headers: { etag: '"v1"' } } : { body: 网页 }) });
    const 新 = (await 发({ 网址: 'https://a.cn/p', 方式: '源码' }, 北京)).内容.结果;
    expect(新).toMatchObject({ status: '成功', finalUrl: 'https://a.cn/p' });
    expect(新.html).toContain('大赛通知');
    const 旧 = (await 发({ 网址: 'https://a.cn/p', 方式: '源码', etag: '"v1"', 最后修改: 'Mon, 09 Nov 2026 00:00:00 GMT' }, 北京)).内容.结果;
    expect(旧).toMatchObject({ status: '没更新', etag: '"v1"', html: '' });
    expect(北京.收到的选项[1]).toMatchObject({ ...上限, etag: '"v1"', 最后修改: 'Mon, 09 Nov 2026 00:00:00 GMT' });
  });
  test('超过 3MB 不读完（读网页真的用上了上限）', async () => {
    const 北京 = 北京读者({ 'https://a.cn/big': { body: 'x', headers: { 'content-type': 'text/html', 'content-length': String(3 * 1024 * 1024 + 1) } } });
    expect((await 发({ 网址: 'https://a.cn/big', 方式: '网页' }, 北京)).内容.结果).toMatchObject({ status: '太大' });
  });
  test('安全检查和美国同一份：本机、内网地址不读，跳转到内网也不读', async () => {
    // 不注入读网页：用默认的 美国/web 读网页；IP 写死的网址不查 DNS、不连网
    expect((await 发({ 网址: 'http://127.0.0.1/admin', 方式: '网页' })).内容.结果).toMatchObject({ status: '网址不安全' });
    expect((await 发({ 网址: 'http://localhost/x', 方式: '源码' })).内容.结果).toMatchObject({ status: '网址不安全' });
    const 北京 = 北京读者({ 'http://8.8.8.8/go': { status: 302, headers: { location: 'http://10.0.0.1/secret' } } });
    const 跳 = (await 发({ 网址: 'http://8.8.8.8/go', 方式: '网页' }, 北京)).内容.结果;
    expect(跳).toMatchObject({ status: '网址不安全' });
    expect(跳.error).toContain('10.0.0.1');
    expect(北京.fetchImpl.calls.map(c => c.url)).toEqual(['http://8.8.8.8/go']);
  });
  test('同一个爬虫身份：北京读网页带的 user-agent 和美国一样', async () => {
    const 北京 = 北京读者({ 'https://a.cn/n': { body: 网页 } });
    await 发({ 网址: 'https://a.cn/n', 方式: '网页' }, 北京);
    expect(北京.fetchImpl.calls[0].init.headers['user-agent']).toMatch(/^competition-crawler\//);
  });
  test('拒收：不是 POST 405；签名不对、过期 401；不是 JSON 400；网址、方式不对 422（都不去读）', async () => {
    let 读过 = 0;
    const 环境 = { 读网页: async () => { 读过 += 1; return {}; }, 取源码: async () => { 读过 += 1; return {}; } };
    expect((await 发({ 网址: 'https://a.cn/', 方式: '网页' }, 环境, { 方法: 'GET' })).状态).toBe(405);
    expect((await 发({ 网址: 'https://a.cn/', 方式: '网页' }, 环境, { 用的秘钥: 'y'.repeat(40) })).内容).toEqual({ ok: false, message: 'sync_signature_invalid' });
    expect((await 发({ 网址: 'https://a.cn/', 方式: '网页' }, 环境, { 时间: Date.now() - 10 * 60e3 })).内容).toEqual({ ok: false, message: 'sync_expired' });
    expect((await 发('不是 JSON', 环境)).状态).toBe(400);
    expect((await 发({ 网址: 'https://a.cn/', 方式: '截图' }, 环境)).状态).toBe(422);
    expect((await 发({ 方式: '网页' }, 环境)).状态).toBe(422);
    expect((await 发({ 网址: 'https://a.cn/', 方式: '源码', etag: 5 }, 环境)).状态).toBe(422);
    expect(读过).toBe(0);
  });
  test('小服务：只认 /sync/fetch，别的路径 404', async () => {
    const 服务 = 建服务({ 秘钥, ...北京读者({ 'https://a.cn/n': { body: 网页 } }) });
    await new Promise(r => 服务.listen(0, '127.0.0.1', r));
    const 端口 = 服务.address().port;
    try {
      const 正文 = JSON.stringify({ 网址: 'https://a.cn/n', 方式: '网页' });
      const 时间 = String(Date.now());
      const 回 = await fetch(`http://127.0.0.1:${端口}${路径}`, { method: 'POST', body: 正文, headers: { 'content-type': 'application/json', [时间头]: 时间, [签名头]: 签名(秘钥, 时间, 正文) } });
      expect(回.status).toBe(200);
      expect((await 回.json()).结果.status).toBe('成功');
      expect((await fetch(`http://127.0.0.1:${端口}/sync/other`, { method: 'POST', body: '{}' })).status).toBe(404);
    } finally {
      await new Promise(r => 服务.close(r));
    }
  });
});

describe('美国端 代读', () => {
  const 地址 = 'https://bj.example/sync/fetch';
  test('签名请求北京，方式“网页”交回读网页的统一结果', async () => {
    const fetchImpl = 转给北京(北京读者({ 'https://a.cn/n': { body: 网页 } }));
    const 结果 = await 代读('https://a.cn/n', { 方式: '网页', endpoint: 地址, 秘钥, fetchImpl });
    expect(checkResult(结果)).toEqual([]);
    expect(结果).toMatchObject({ status: '成功', title: '大赛通知' });
    expect(fetchImpl.发过[0].地址).toBe(地址);
    expect(JSON.parse(fetchImpl.发过[0].正文)).toEqual({ 网址: 'https://a.cn/n', 方式: '网页' });
  });
  test('方式“源码”：带 etag、最后修改，交回取源码的格式', async () => {
    const fetchImpl = 转给北京(北京读者({ 'https://a.cn/p': { status: 304, headers: { etag: '"v1"' } } }));
    const 结果 = await 代读('https://a.cn/p', { 方式: '源码', etag: '"v1"', 最后修改: 'x', endpoint: 地址, 秘钥, fetchImpl });
    expect(结果).toMatchObject({ status: '没更新', etag: '"v1"', html: '' });
    expect(JSON.parse(fetchImpl.发过[0].正文)).toEqual({ 网址: 'https://a.cn/p', 方式: '源码', etag: '"v1"', 最后修改: 'x' });
  });
  test('连不上北京：交回“网络错误”，error 写“北京代读失败：…”，格式和读网页一样，不抛', async () => {
    const fetchImpl = async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }); };
    const 结果 = await 代读('https://a.cn/n', { endpoint: 地址, 秘钥, fetchImpl });
    expect(checkResult(结果)).toEqual([]);
    expect(结果).toMatchObject({ url: 'https://a.cn/n', status: '网络错误', text: '', links: [] });
    expect(结果.error).toMatch(/^北京代读失败：.*ECONNREFUSED/);
  });
  test('北京不收（签名不对等）：交回取源码格式的“网络错误”', async () => {
    const fetchImpl = 转给北京({});
    const 结果 = await 代读('https://a.cn/p', { 方式: '源码', endpoint: 地址, 秘钥: 'z'.repeat(40), fetchImpl });
    expect(结果).toEqual({ url: 'https://a.cn/p', finalUrl: null, status: '网络错误', httpStatus: null, html: '', etag: null, 最后修改: null, error: expect.stringMatching(/^北京代读失败：.*401.*sync_signature_invalid/) });
  });
  test('北京交回的不是结果、没配地址或秘钥：也是“网络错误”', async () => {
    const 坏 = await 代读('https://a.cn/n', { endpoint: 地址, 秘钥, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) });
    expect(坏).toMatchObject({ status: '网络错误', error: expect.stringContaining('北京代读失败') });
    expect(await 代读('https://a.cn/n', { endpoint: '', 秘钥 })).toMatchObject({ status: '网络错误', error: expect.stringContaining('没配') });
    expect(await 代读('https://a.cn/n', { endpoint: 地址, 秘钥: '' })).toMatchObject({ status: '网络错误', error: expect.stringContaining('没配') });
  });
  test('北京太久不回：按超时停，交回“网络错误”', async () => {
    const fetchImpl = (_, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    const 结果 = await 代读('https://a.cn/n', { endpoint: 地址, 秘钥, fetchImpl, 超时: 20 });
    expect(结果).toMatchObject({ status: '网络错误', error: expect.stringContaining('北京代读失败') });
  });
  test('起一个真的北京小服务，美国端走 HTTP 代读', async () => {
    const 服务 = 建服务({ 秘钥, ...北京读者({ 'https://a.cn/n': { body: 网页 } }) });
    await new Promise(r => 服务.listen(0, '127.0.0.1', r));
    try {
      const 结果 = await 代读('https://a.cn/n', { endpoint: `http://127.0.0.1:${服务.address().port}${路径}`, 秘钥 });
      expect(结果).toMatchObject({ status: '成功', title: '大赛通知' });
    } finally {
      await new Promise(r => 服务.close(r));
    }
  });
});

