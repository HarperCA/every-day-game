// 爬虫脚本、指纹记录（2026-11-08 用户定）：每个比赛一份爬虫脚本（Codex 写的一串步骤，程序照着操控网页或无头浏览器取通知列表），
// 一份指纹记录（通知列表的指纹和上次看到的条目，下次先比指纹，没变就跳过）。存在比赛库 crawl_script、page_fingerprint 表，经 db/index.mjs 读写。
import { describe, expect, test } from 'vitest';
import { open, seed } from '../../../test/复用/样例数据.mjs';
import { 爬虫脚本, 指纹, 比赛 } from '../../../index.mjs';

const 步骤 = [
  { 动作: '打开', 网址: 'https://www.mcm.edu.cn/' },
  { 动作: '点击', 选择器: 'a.tzgg' },
  { 动作: '等待', 选择器: 'ul.list li' },
  { 动作: '取列表', 条目: 'ul.list li', 标题: 'a', 链接: 'a', 日期: 'span.date' },
];
const 一份 = { 列表页: 'https://www.mcm.edu.cn/tzgg/', 步骤, 要浏览器: true, 写的人: 'Codex', 提示版本: 'crawl-script-v1' };
const 库 = () => { const db = open(); seed(db); return db; };

describe('爬虫脚本', () => {
  test('步骤只认 打开、等待、点击、取列表 四种；最后一步要是取列表；最多 20 步', () => {
    expect(爬虫脚本.动作们).toEqual(['打开', '等待', '点击', '取列表']);
    expect(() => 爬虫脚本.校验步骤(步骤)).not.toThrow();
    expect(() => 爬虫脚本.校验步骤([{ 动作: '取列表', 条目: 'li' }])).not.toThrow();
    for (const [坏, 原因] of [
      [[], '至少一步'],
      [[{ 动作: '运行', 代码: 'x' }, { 动作: '取列表', 条目: 'li' }], '不认识的动作：运行'],
      [[{ 动作: '打开', 网址: 'javascript:alert(1)' }, { 动作: '取列表', 条目: 'li' }], '打开要给 http 网址'],
      [[{ 动作: '点击' }, { 动作: '取列表', 条目: 'li' }], '点击要给选择器'],
      [[{ 动作: '等待' }, { 动作: '取列表', 条目: 'li' }], '等待要给选择器或毫秒'],
      [[{ 动作: '等待', 毫秒: 60000 }, { 动作: '取列表', 条目: 'li' }], '等待最多 15000 毫秒'],
      [[{ 动作: '打开', 网址: 'https://a.cn/' }], '最后一步要是取列表'],
      [[{ 动作: '取列表' }], '取列表要给条目选择器'],
      [Array.from({ length: 21 }, () => ({ 动作: '取列表', 条目: 'li' })), '最多 20 步'],
    ]) expect(() => 爬虫脚本.校验步骤(坏), 原因).toThrow(原因);
  });
  test('写一份、读回来；没有时读到 null；还没有时不带版本就新建，已有要带读到的版本号', () => {
    const db = 库();
    expect(爬虫脚本.读(db, 'event-math')).toBeNull();
    expect(爬虫脚本.写(db, 'event-math', 一份, { 操作人: '新维护' })).toEqual({ id: 'event-math', version: 1 });
    expect(爬虫脚本.读(db, 'event-math')).toMatchObject({ 比赛: 'event-math', version: 1, ...一份, 上次跑通: null, 连续失败: 0, 上次错误: null, updated_by: '新维护' });
    expect(() => 爬虫脚本.写(db, 'event-math', 一份)).toThrow('已有爬虫脚本');
    expect(爬虫脚本.写(db, 'event-math', { ...一份, 要浏览器: false }, { 版本: 1 })).toEqual({ id: 'event-math', version: 2 });
    expect(() => 爬虫脚本.写(db, 'event-math', 一份, { 版本: 1 })).toThrow();
  });
  test('写之前校验步骤和列表页；没有这个比赛报找不到', () => {
    const db = 库();
    expect(() => 爬虫脚本.写(db, 'event-math', { ...一份, 步骤: [{ 动作: '运行' }] })).toThrow('不认识的动作');
    expect(() => 爬虫脚本.写(db, 'event-math', { ...一份, 列表页: 'ftp://a' })).toThrow();
    expect(() => 爬虫脚本.写(db, 'event-none', 一份)).toThrow();
  });
  test('记结果：跑通记时间、失败数清零；失败数加一、记下原因；重写脚本后失败数清零', () => {
    const db = 库();
    爬虫脚本.写(db, 'event-math', 一份);
    爬虫脚本.记结果(db, 'event-math', { 成功: false, 错误: '选择器取不到', 时间: '2026-11-08T02:00:00.000Z' });
    爬虫脚本.记结果(db, 'event-math', { 成功: false, 错误: '打不开', 时间: '2026-11-08T03:00:00.000Z' });
    expect(爬虫脚本.读(db, 'event-math')).toMatchObject({ 连续失败: 2, 上次错误: '打不开', 上次跑通: null });
    爬虫脚本.记结果(db, 'event-math', { 成功: true, 时间: '2026-11-08T04:00:00.000Z' });
    expect(爬虫脚本.读(db, 'event-math')).toMatchObject({ 连续失败: 0, 上次错误: null, 上次跑通: '2026-11-08T04:00:00.000Z' });
    爬虫脚本.记结果(db, 'event-math', { 成功: false, 错误: 'x', 时间: '2026-11-08T05:00:00.000Z' });
    爬虫脚本.写(db, 'event-math', 一份, { 版本: 爬虫脚本.读(db, 'event-math').version });
    expect(爬虫脚本.读(db, 'event-math')).toMatchObject({ 连续失败: 0, 上次错误: null });
  });
});

const 条 = (标题, 链接, 日期 = '2026-04-01') => ({ 标题, 链接, 日期 });
const 列表 = [条('关于举办2026年全国大学生数学建模竞赛的通知', 'https://www.mcm.edu.cn/a.html'), 条('2025年赛题', 'https://www.mcm.edu.cn/b.html', '2025-09-01')];

describe('指纹', () => {
  test('算指纹：只看链接和标题（去空白），和顺序、日期无关；内容一变就不一样', () => {
    const a = 指纹.算指纹(列表);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
    expect(指纹.算指纹([...列表].reverse())).toBe(a);
    expect(指纹.算指纹(列表.map(x => ({ ...x, 日期: '' , 标题: ` ${x.标题} ` })))).toBe(a);
    expect(指纹.算指纹([...列表, 条('新通知', 'https://www.mcm.edu.cn/c.html')])).not.toBe(a);
  });
  test('比对：第一次没有旧记录；指纹一样没变；变了交回新增的条目（按链接）', () => {
    expect(指纹.比对(null, 列表)).toMatchObject({ 第一次: true, 变了: true, 新增: 列表 });
    const 旧 = { 指纹: 指纹.算指纹(列表), 条目们: 列表 };
    expect(指纹.比对(旧, [...列表].reverse())).toMatchObject({ 第一次: false, 变了: false, 新增: [] });
    const 新 = 条('关于2026年竞赛报名的补充通知', 'https://www.mcm.edu.cn/c.html');
    expect(指纹.比对(旧, [新, ...列表])).toMatchObject({ 第一次: false, 变了: true, 新增: [新] });
  });
  test('记：第一次新建；内容没变只改检查时间、变化时间留着；变了两个时间都改；交回变没变', () => {
    const db = 库();
    expect(指纹.读(db, 'event-math')).toBeNull();
    expect(指纹.记(db, 'event-math', { 列表页: 'https://www.mcm.edu.cn/tzgg/', etag: '"abc"', 最后修改: 'Sat, 01 Nov 2026 00:00:00 GMT', 条目们: 列表, 时间: '2026-11-08T01:00:00.000Z' }))
      .toMatchObject({ id: 'event-math', 变了: true });
    expect(指纹.读(db, 'event-math')).toMatchObject({ 比赛: 'event-math', 列表页: 'https://www.mcm.edu.cn/tzgg/', etag: '"abc"', 最后修改: 'Sat, 01 Nov 2026 00:00:00 GMT',
      指纹: 指纹.算指纹(列表), 条目们: 列表, 检查时间: '2026-11-08T01:00:00.000Z', 变化时间: '2026-11-08T01:00:00.000Z' });
    expect(指纹.记(db, 'event-math', { 列表页: 'https://www.mcm.edu.cn/tzgg/', 条目们: 列表, 时间: '2026-11-09T01:00:00.000Z' }).变了).toBe(false);
    expect(指纹.读(db, 'event-math')).toMatchObject({ 检查时间: '2026-11-09T01:00:00.000Z', 变化时间: '2026-11-08T01:00:00.000Z', etag: null });
    expect(指纹.记(db, 'event-math', { 列表页: 'https://www.mcm.edu.cn/tzgg/', 条目们: [条('新', 'https://www.mcm.edu.cn/c.html'), ...列表], 时间: '2026-11-10T01:00:00.000Z' }).变了).toBe(true);
    expect(指纹.读(db, 'event-math')).toMatchObject({ 检查时间: '2026-11-10T01:00:00.000Z', 变化时间: '2026-11-10T01:00:00.000Z' });
  });
  test('记检查：网站说没更新（304）时只改检查时间', () => {
    const db = 库();
    指纹.记(db, 'event-math', { 列表页: 'https://www.mcm.edu.cn/tzgg/', etag: '"abc"', 条目们: 列表, 时间: '2026-11-08T01:00:00.000Z' });
    指纹.记检查(db, 'event-math', '2026-11-09T01:00:00.000Z');
    expect(指纹.读(db, 'event-math')).toMatchObject({ etag: '"abc"', 检查时间: '2026-11-09T01:00:00.000Z', 变化时间: '2026-11-08T01:00:00.000Z' });
  });
  test('条目最多存 100 条', () => {
    const db = 库();
    const 多 = Array.from({ length: 150 }, (_, i) => 条(`通知${i}`, `https://a.cn/${i}.html`));
    指纹.记(db, 'event-math', { 列表页: 'https://a.cn/', 条目们: 多, 时间: '2026-11-08T01:00:00.000Z' });
    expect(指纹.读(db, 'event-math').条目们).toHaveLength(100);
  });
});

describe('和比赛一起', () => {
  test('比赛彻底删除时，爬虫脚本和指纹记录连带删掉', () => {
    const db = 库();
    爬虫脚本.写(db, 'event-math', 一份);
    指纹.记(db, 'event-math', { 列表页: 'https://a.cn/', 条目们: 列表, 时间: '2026-11-08T01:00:00.000Z' });
    const 回 = db.彻底删除('competition', 'event-math');
    expect(回.连带).toMatchObject({ crawl_script: 1, page_fingerprint: 1 });
    expect(爬虫脚本.读(db, 'event-math')).toBeNull();
    expect(指纹.读(db, 'event-math')).toBeNull();
    void 比赛;
  });
});
