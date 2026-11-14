// 公开比赛同步：美国比赛库里已公开的比赛、届次推到北京主数据库。美国端读库、算变化、分批、推海报；北京端验签名后交给主数据库的 同步.收下。
// 规则照旧 scripts/server/sync-public-cache.mjs：只推有变化的；每 24 小时整体重推一次；美国读到 0 条拒绝推送；下架的在北京也删。
// 两边都用内存里的库；网络换成直接调北京端，不连真实服务器。
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { open, seed } from '../../../../美国/db/test/复用/样例数据.mjs';
import { 比赛, 届次, 图片总库 } from '../../../../美国/db/index.mjs';
import { openMainDb, 公开, 海报 } from '../../../../北京/主数据库/index.mjs';
import { 假JPG } from '../../../../共用/test/复用/假图片.mjs';
import { 整理届次, 整理比赛, 签名, 验签 } from '../../格式.mjs';
import { 推送 } from '../../美国端.mjs';
import { 建服务, 接收 } from '../../北京端.mjs';

const 秘钥 = 'x'.repeat(40);
const 临时 = [];
const 新目录 = 名 => { const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), `${名}-`)); 临时.push(目录); return 目录; };
afterEach(() => { for (const 目录 of 临时.splice(0)) fs.rmSync(目录, { recursive: true, force: true }); });

describe('格式：按公开字段白名单整理', () => {
  test('届次只带公开字段；推荐只留等级、理由（最多 3 条）等；海报只带合格的文件名；下一届预计只给已归档的；来源只给官方、核验有效的网址', () => {
    const 回 = 整理届次({
      id: 'e1', competition_id: 'c1', version: 3, edition_name: '2026', registration_start: '2026-09-01', registration_end: '2026-10-01', status: '已归档',
      fee_type: '免费', time_note: '以赛区通知为准', status_reason: ['机器说的'], manual_fields: ['fee_type'], discovery: { 路线: 'x' }, created_by: '管理员',
      poster: { file: `${'a'.repeat(64)}.jpg`, source: 'official', sourceUrl: 'https://a.cn', updatedAt: 'x' }, poster_candidates: [{ file: 'y' }],
      recommendation: { recommendation: '值得参加', reasons: ['1', '2', '3', '4'], suitable_for: '本科生', confidence: '中', system_validation: 'passed', rule_version: 7 },
      legacy: { nextEditionEstimate: '2027-09-01', task: { x: 1 } },
    }, [
      { url: 'https://org.cn/a', source_type: 'organizer_website', is_official: true, validity_status: 'valid', id: 's1' },
      { url: 'https://blog.cn/b', source_type: 'news', is_official: false, validity_status: 'valid', id: 's2' },
      { url: 'https://org.cn/c', source_type: 'organizer_website', is_official: true, validity_status: 'invalid', id: 's3' },
    ]);
    expect(回).toMatchObject({ id: 'e1', competition_id: 'c1', version: 3, registration_start: '2026-09-01', registration_end: '2026-10-01', status: '已归档' });
    expect(回.data).toEqual({
      edition_name: '2026', fee_type: '免费', time_note: '以赛区通知为准',
      poster: { file: `${'a'.repeat(64)}.jpg` },
      recommendation: { recommendation: '值得参加', reasons: ['1', '2', '3'], suitable_for: '本科生', confidence: '中' },
      next_edition_estimate: '2027-09-01',
      sources: [{ id: 's1', source_type: 'organizer_website', url: 'https://org.cn/a' }],
      info_source: 'official',   // 2026-11-12：信息来源（高校转发的见 信息来源.test.mjs）
    });
    const 发布中 = 整理届次({ id: 'e2', competition_id: 'c1', version: 1, edition_name: 'x', status: '已发布', poster: { file: '../x.jpg' }, legacy: { nextEditionEstimate: '2027-01-01' } }, []);
    expect(发布中.data).toEqual({ edition_name: 'x', info_source: 'official' });
  });
  test('下一届预计：先用每日归档算出来存的 next_edition_estimate（2026-11-03），没有再用旧记录带来的；比赛库里这一列本身不当普通公开字段重复带', () => {
    const 新 = 整理届次({ id: 'e3', competition_id: 'c1', version: 1, edition_name: 'x', status: '已归档', next_edition_estimate: '2027-10-01T00:00:00.000Z', legacy: { nextEditionEstimate: '2027-01-01' } }, []);
    expect(新.data).toEqual({ edition_name: 'x', next_edition_estimate: '2027-10-01T00:00:00.000Z', info_source: 'official' });
    const 旧 = 整理届次({ id: 'e4', competition_id: 'c1', version: 1, edition_name: 'x', status: '已归档', next_edition_estimate: null, legacy: { nextEditionEstimate: '2027-01-01' } }, []);
    expect(旧.data.next_edition_estimate).toBe('2027-01-01');
  });
  test('比赛：名称、级别单独放，其余公开字段放 data（没填的不带）', () => {
    expect(整理比赛({ id: 'c1', version: 2, name: '数学建模', level: '国家级', aliases: ['国赛数模'], professions: ['数学与统计'], region: null, manual_fields: ['name'], last_maintained_at: 'x' }))
      .toEqual({ id: 'c1', version: 2, name: '数学建模', level: '国家级', data: { aliases: ['国赛数模'], professions: ['数学与统计'] } });
  });
});

describe('签名：两台服务器共用同步秘钥，带时间，5 分钟内有效', () => {
  const 时间 = 1_800_000_000_000;
  test('签对了才通过；内容改过、超过 5 分钟、秘钥不对都不认；秘钥太短直接报错', () => {
    const 签 = 签名(秘钥, 时间, '{"a":1}');
    expect(验签(秘钥, String(时间), '{"a":1}', 签, { now: 时间 + 60_000 })).toEqual({ ok: true });
    expect(验签(秘钥, String(时间), '{"a":2}', 签, { now: 时间 })).toEqual({ ok: false, 原因: '签名不对' });
    expect(验签(秘钥, String(时间), '{"a":1}', 签, { now: 时间 + 6 * 60_000 })).toEqual({ ok: false, 原因: '已过期' });
    expect(验签('y'.repeat(40), String(时间), '{"a":1}', 签, { now: 时间 })).toEqual({ ok: false, 原因: '签名不对' });
    expect(验签(秘钥, '', '{"a":1}', 签, { now: 时间 })).toEqual({ ok: false, 原因: '缺签名' });
    expect(() => 签名('短', 时间, 'x')).toThrow('秘钥');
  });
});

// 美国比赛库：数学 2026 已发布、2025 已归档；艺术两届还待人工审核（不公开）
function 美国库() {
  const db = open(); seed(db);
  届次.改状态(db, 'ed-math-2025', '已归档', 1);
  return db;
}
function 两边(选项 = {}) {
  const 美库 = 美国库();
  const 北库 = openMainDb({ file: ':memory:' });
  const 状态文件 = path.join(新目录('同步状态'), '状态.json');
  const 美图 = 新目录('美国图片'); const 北图 = 新目录('北京海报');
  const 请求们 = [];
  let 现在 = new Date('2026-11-02T00:00:00.000Z');
  const fetch = async (地址, init) => {
    请求们.push(JSON.parse(init.body));
    if (选项.坏海报 && JSON.parse(init.body).海报们) return { ok: false, status: 500, json: async () => ({ ok: false, message: '假装出错' }) };
    const { 状态, 内容 } = await 接收({ 方法: init.method, 头: Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v])), 正文: init.body },
      { 主库: 北库, 秘钥, 海报目录: 北图, now: 现在 });
    return { ok: 状态 < 300, status: 状态, json: async () => 内容 };
  };
  const 推 = (额外 = {}) => 推送({ db: 美库, 地址: 'http://北京/sync/public', 秘钥, 状态文件, 图片目录: 美图, fetch, now: 现在, ...额外 });
  return { 美库, 北库, 美图, 北图, 请求们, 推, 拨到: 时间 => { 现在 = new Date(时间); } };
}

describe('推送（美国端 → 北京端）', () => {
  test('第一次：已发布、已归档的届次和它们的比赛都推过去；待人工审核的不推', async () => {
    const { 北库, 推 } = 两边();
    expect(await 推()).toMatchObject({ 比赛: 1, 届次: 2, 下架: 0, 海报: 0, 全量: true });
    expect(公开.全部条目(北库).map(条 => 条.id).sort()).toEqual(['ed-math-2025', 'ed-math-2026']);
    expect(公开.比赛(北库, 'event-art')).toBeNull();
  });
  test('没有变化：一个请求都不发；改了一届只推这一届', async () => {
    const { 美库, 北库, 请求们, 推 } = 两边();
    await 推();
    请求们.length = 0;
    expect(await 推()).toMatchObject({ 比赛: 0, 届次: 0, 下架: 0 });
    expect(请求们).toEqual([]);
    届次.编辑(美库, 'ed-math-2026', { fee_type: '免费' }, 1);
    expect(await 推()).toMatchObject({ 比赛: 0, 届次: 1 });
    expect(公开.届次(北库, 'ed-math-2026').fee_type).toBe('免费');
  });
  test('下架：转回待人工审核的届次、删掉的比赛，北京也删', async () => {
    const { 美库, 北库, 推 } = 两边();
    await 推();
    届次.改状态(美库, 'ed-math-2025', '待人工审核', 2);
    expect(await 推()).toMatchObject({ 下架: 1 });
    expect(公开.全部条目(北库).map(条 => 条.id)).toEqual(['ed-math-2026']);
    届次.改状态(美库, 'ed-art-2026', '已发布', 1);   // 留一场公开的，免得触发“0 条不推”
    比赛.删除(美库, 'event-math');
    expect(await 推()).toMatchObject({ 比赛: 1, 届次: 1, 下架: 2 });
    expect(公开.全部条目(北库).map(条 => 条.id)).toEqual(['ed-art-2026']);
    expect(公开.比赛(北库, 'event-math')).toBeNull();
  });
  test('美国一条公开的都读不到：拒绝推送，不发请求（防止把北京清空）', async () => {
    const { 美库, 请求们, 推 } = 两边();
    for (const id of ['ed-math-2025', 'ed-math-2026']) 届次.删除(美库, id);
    await expect(推()).rejects.toThrow('0 条');
    expect(请求们).toEqual([]);
  });
  test('每 24 小时整体重推一次，同版本也覆盖（白名单改了、两边走样时能改回来）', async () => {
    const { 北库, 推, 拨到 } = 两边();
    await 推();
    北库.update('public_edition', 'ed-math-2026', { data: { edition_name: '被改坏了' } });
    拨到('2026-11-02T12:00:00.000Z');
    expect(await 推()).toMatchObject({ 届次: 0, 全量: false });
    拨到('2026-11-03T00:00:01.000Z');
    expect(await 推()).toMatchObject({ 届次: 2, 全量: true });
    expect(公开.届次(北库, 'ed-math-2026').edition_name).toBe('2026 年数学建模');
  });
  test('海报：先推图片（一张一个请求，推过的不再推），再推数据；北京收到后卡片能拿到', async () => {
    const { 美库, 美图, 北图, 请求们, 推 } = 两边();
    const { 文件 } = 图片总库.存(假JPG(640, 360, 2000), '海报', { 目录: 美图 });
    届次.编辑(美库, 'ed-math-2026', { poster: { file: 文件, source: 'manual', sourceUrl: '', updatedAt: 'x' } }, 1);
    expect(await 推()).toMatchObject({ 海报: 1 });
    expect(请求们[0].海报们.map(x => x.文件)).toEqual([文件]);
    expect(海报.有(文件, { 目录: 北图 })).toBe(true);
    请求们.length = 0;
    届次.编辑(美库, 'ed-math-2026', { fee_type: '免费' }, 2);
    await 推();
    expect(请求们.some(r => r.海报们)).toBe(false);
  });
  test('海报推不上去：比赛数据照推，这张下次再试', async () => {
    const { 美库, 美图, 北库, 请求们, 推 } = 两边({ 坏海报: true });
    const { 文件 } = 图片总库.存(假JPG(640, 360, 2000), '海报', { 目录: 美图 });
    届次.编辑(美库, 'ed-math-2026', { poster: { file: 文件, source: 'manual', sourceUrl: '', updatedAt: 'x' } }, 1);
    expect(await 推()).toMatchObject({ 海报: 0, 海报失败: 1, 届次: 2 });
    expect(北库.count('public_edition')).toBe(2);
    请求们.length = 0;
    await 推();
    expect(请求们.filter(r => r.海报们)).toHaveLength(1);
  });
  test('试跑：只算要推什么，不发请求、不记状态', async () => {
    const { 请求们, 推 } = 两边();
    expect(await 推({ 试跑: true })).toMatchObject({ 比赛: 1, 届次: 2, 试跑: true });
    expect(请求们).toEqual([]);
    expect(await 推()).toMatchObject({ 届次: 2 });
  });
});

describe('北京端：只认签名对、时间新的请求', () => {
  const 北 = () => ({ 主库: openMainDb({ file: ':memory:' }), 秘钥, 海报目录: 新目录('北京海报'), now: new Date('2026-11-02T00:00:00.000Z') });
  const 带签 = (正文, 时间 = Date.parse('2026-11-02T00:00:00.000Z')) => ({ 方法: 'POST', 头: { 'x-sync-time': String(时间), 'x-sync-signature': 签名(秘钥, 时间, 正文) }, 正文 });
  test('签名不对、过期、没签名：401，库里不写', async () => {
    const 环境 = 北();
    const 正文 = JSON.stringify({ 比赛们: [{ id: 'c', version: 1, name: 'x', level: '国家级', data: {} }] });
    expect((await 接收({ ...带签(正文), 正文: 正文.replace('x', 'y') }, 环境)).状态).toBe(401);
    expect((await 接收(带签(正文, Date.parse('2026-11-01T23:50:00.000Z')), 环境))).toMatchObject({ 状态: 401, 内容: { ok: false, message: 'sync_expired' } });
    expect((await 接收({ 方法: 'POST', 头: {}, 正文 }, 环境)).状态).toBe(401);
    expect(环境.主库.count('public_competition')).toBe(0);
  });
  test('不是 POST：405；不是 JSON：400；内容不对（例如待人工审核的届次）：422，整批不收', async () => {
    const 环境 = 北();
    expect((await 接收({ ...带签('{}'), 方法: 'GET' }, 环境)).状态).toBe(405);
    expect((await 接收(带签('不是json'), 环境)).状态).toBe(400);
    const 坏 = JSON.stringify({ 比赛们: [{ id: 'c', version: 1, name: 'x', level: '国家级', data: {} }], 届次们: [{ id: 'e', competition_id: 'c', version: 1, status: '待人工审核', data: {} }] });
    expect((await 接收(带签(坏), 环境))).toMatchObject({ 状态: 422, 内容: { ok: false } });
    expect(环境.主库.count('public_competition')).toBe(0);
  });
  test('签名对：交给主数据库收下，交回收下的结果', async () => {
    const 环境 = 北();
    const 正文 = JSON.stringify({ 比赛们: [{ id: 'c', version: 1, name: 'x', level: '国家级', data: {} }] });
    expect(await 接收(带签(正文), 环境)).toEqual({ 状态: 200, 内容: { ok: true, 新增: 1, 更新: 0, 跳过: 0, 下架: 0, 海报: 0 } });
  });
});

// 2026-11-03 部署时实测：推海报（纯英文的 base64）都过了，带中文的比赛数据被北京当成签名不对。原因是小服务器逐块把字节转成文字再拼，
// 汉字切在两块之间成了乱码。这里起真的 HTTP 服务、用真的 fetch 发一大批中文，确认整条路通（之前的测试都直接调 接收，测不到）。
describe('走真实 HTTP', () => {
  test('一大批带中文的比赛数据经 HTTP 推过去，签名照样对', async () => {
    const 秘钥 = 'h'.repeat(40);
    const 主库 = openMainDb({ file: ':memory:' });
    const 服务 = 建服务({ 主库, 秘钥 });
    await new Promise(r => 服务.listen(0, '127.0.0.1', r));
    try {
      const 地址 = `http://127.0.0.1:${服务.address().port}/sync/public`;
      const 比赛们 = Array.from({ length: 400 }, (_, i) => ({ id: `event-${i}`, version: 1, name: `第${i}届全国大学生数学建模与计算机应用能力挑战赛`, level: '国家级', data: { organizer: '中国工业与应用数学学会'.repeat(5) } }));
      const 正文 = JSON.stringify({ 比赛们 });
      expect(Buffer.byteLength(正文)).toBeGreaterThan(100 * 1024);
      const 时间 = String(Date.now());
      // 像经过 nginx 和真实网络那样一小块一小块到（1001 字节一块，汉字必然被切开）
      const 回 = await new Promise((好, 坏) => {
        const 请求 = http.request(地址, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(正文), 'x-sync-time': 时间, 'x-sync-signature': 签名(秘钥, 时间, 正文) } }, res => {
          let 文字 = ''; res.setEncoding('utf8'); res.on('data', d => { 文字 += d; }); res.on('end', () => 好({ json: async () => JSON.parse(文字) }));
        });
        请求.on('error', 坏);
        const 字节 = Buffer.from(正文);
        (async () => { for (let i = 0; i < 字节.length; i += 1001) { 请求.write(字节.subarray(i, i + 1001)); await new Promise(r => setTimeout(r, 1)); } 请求.end(); })();
      });
      expect(await 回.json()).toMatchObject({ ok: true, 新增: 400 });
    } finally {
      await new Promise(r => 服务.close(r));
    }
  });
});
