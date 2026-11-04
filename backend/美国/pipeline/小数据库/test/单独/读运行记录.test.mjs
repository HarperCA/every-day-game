// 读运行记录：给后台“抓取结果账”页读每晚的 run.db，只读。列出有哪几晚；读一晚：各模块怎么样、每条候选的去向和原因、写进比赛库没有。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { openSqlite } from '../../../../../共用/工具/sqlite.mjs';
import { openRunDb, 列出几晚, 读一晚, 读候选网站 } from '../../index.mjs';

const 临时 = [];
afterEach(() => { while (临时.length) fs.rmSync(临时.pop(), { recursive: true, force: true }); });

function 准备() {
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  临时.push(根);
  const 建 = (名, 填, 报告 = '') => {
    fs.mkdirSync(path.join(根, 名));
    openRunDb(path.join(根, 名, 'run.db'), { runId: 名 }).close();
    if (报告) fs.writeFileSync(path.join(根, 名, 'report.md'), 报告);
    const db = openSqlite(path.join(根, 名, 'run.db'));
    填?.(db);
    db.close();
  };
  建('2026-10-31', null);
  建('2026-11-01', db => {
    db.prepare("INSERT INTO meta (key, value) VALUES ('当晚信息', ?)").run(JSON.stringify({ 计划: { 搜索词们: [{ 词: '数学建模 竞赛' }, { 词: '机器人 竞赛' }] }, 搜索词: 2, 平台: 0, 候选: 3 }));
    const 模块 = db.prepare('INSERT INTO modules (name, status, started_at, finished_at, stats, error) VALUES (?, ?, ?, ?, ?, ?)');
    模块.run('01-search', '完成', '2026-10-31T17:00:00Z', '2026-10-31T17:05:00Z', JSON.stringify({ items: 3, byStatus: { 进行中: 3 }, changes: 0, problems: ['1 个搜索词失败'] }), null);
    模块.run('03-filter', '完成', '2026-10-31T17:05:00Z', '2026-10-31T17:20:00Z', JSON.stringify({ items: 3, byStatus: { 进行中: 1, 已丢弃: 2 }, changes: 0, problems: [] }), null);
    模块.run('04-extract', '跳过', '2026-10-31T17:20:00Z', '2026-10-31T17:40:00Z', null, '读网页超时太多');
    const 条目 = db.prepare("INSERT INTO items (key, kind, status, stage, data, created_by, updated_at) VALUES (?, 'candidate', ?, ?, ?, '01-search', '2026-10-31T17:20:00Z')");
    const 经过 = db.prepare("INSERT INTO trail (key, module, status, result, reason, at) VALUES (?, ?, ?, '', ?, ?)");
    条目.run('https://a.cn/1', '进行中', '06-ingest', JSON.stringify({ name: '甲杯', url: 'https://a.cn/1' }));
    经过.run('https://a.cn/1', '01-search', '进行中', '', '2026-10-31T17:05:00Z');
    经过.run('https://a.cn/1', '06-ingest', '进行中', '06 入库：新比赛', '2026-10-31T17:50:00Z');
    for (const [k, 名] of [['https://a.cn/2', '乙'], ['https://a.cn/3', '丙']]) {
      条目.run(k, '已丢弃', '03-filter', JSON.stringify({ name: 名, url: k }));
      经过.run(k, '03-filter', '已丢弃', '03 筛选·标题筛选：不是比赛', '2026-10-31T17:10:00Z');
    }
    const 改动 = db.prepare("INSERT INTO changes (module, item_key, tbl, row_key, op, payload, result, reason, at) VALUES ('06-ingest', ?, ?, ?, 'insert', '{}', ?, ?, '2026-10-31T17:50:00Z')");
    改动.run('https://a.cn/1', 'competition', 'event-1', '已写入', '');
    改动.run('https://a.cn/1', 'edition', 'edition-1', '已写入', '');
    改动.run('https://a.cn/1', 'source', 'source-1', '不提交', '字段不合格');
  }, '# 当晚总报告 2026-11-01\n\n- 开始：2026-10-31T17:00:00Z\n- 结束：2026-10-31T17:55:00Z\n- 方式：正式运行\n- 结果：全部模块跑完\n');
  fs.mkdirSync(path.join(根, '2026-11-01-02'));              // 没有 run.db：不列
  fs.writeFileSync(path.join(根, '.运行中.lock'), '');        // 不是运行文件夹
  return 根;
}

describe('列出几晚', () => {
  test('有 run.db 的运行文件夹，新的在前；根目录不存在是空的', () => {
    const 根 = 准备();
    expect(列出几晚({ 根 })).toEqual(['2026-11-01', '2026-10-31']);
    expect(列出几晚({ 根: path.join(根, '没有') })).toEqual([]);
  });
});

describe('读一晚', () => {
  test('当晚概况：开始、结束、方式、结果（来自 report.md）；搜索词和候选数', () => {
    const r = 读一晚({ 根: 准备(), 名: '2026-11-01' });
    expect(r).toMatchObject({ 名: '2026-11-01', 开始: '2026-10-31T17:00:00Z', 结束: '2026-10-31T17:55:00Z', 方式: '正式运行', 结果: '全部模块跑完',
      搜索词们: ['数学建模 竞赛', '机器人 竞赛'], 候选: 3 });
  });
  test('各模块：状态、起止、处理多少、各状态多少、问题或错误；没跑的不列', () => {
    const r = 读一晚({ 根: 准备(), 名: '2026-11-01' });
    expect(r.模块们).toEqual([
      { 模块: '01-search', 状态: '完成', 开始: '2026-10-31T17:00:00Z', 结束: '2026-10-31T17:05:00Z', 处理: 3, 各状态: { 进行中: 3 }, 改动: 0, 问题: ['1 个搜索词失败'], 错误: '' },
      { 模块: '03-filter', 状态: '完成', 开始: '2026-10-31T17:05:00Z', 结束: '2026-10-31T17:20:00Z', 处理: 3, 各状态: { 进行中: 1, 已丢弃: 2 }, 改动: 0, 问题: [], 错误: '' },
      { 模块: '04-extract', 状态: '跳过', 开始: '2026-10-31T17:20:00Z', 结束: '2026-10-31T17:40:00Z', 处理: null, 各状态: {}, 改动: null, 问题: [], 错误: '读网页超时太多' },
    ]);
  });
  test('条目：最后的状态、停在哪个模块、最后一条原因；同样的去向合在一起计数', () => {
    const r = 读一晚({ 根: 准备(), 名: '2026-11-01' });
    expect(r.条目们).toEqual([
      { 网址: 'https://a.cn/1', 名称: '甲杯', 状态: '进行中', 模块: '06-ingest', 原因: '06 入库：新比赛' },
      { 网址: 'https://a.cn/2', 名称: '乙', 状态: '已丢弃', 模块: '03-filter', 原因: '03 筛选·标题筛选：不是比赛' },
      { 网址: 'https://a.cn/3', 名称: '丙', 状态: '已丢弃', 模块: '03-filter', 原因: '03 筛选·标题筛选：不是比赛' },
    ]);
    expect(r.去向们).toEqual([
      { 模块: '03-filter', 状态: '已丢弃', 原因: '03 筛选·标题筛选：不是比赛', 次数: 2 },
      { 模块: '06-ingest', 状态: '进行中', 原因: '06 入库：新比赛', 次数: 1 },
    ]);
  });
  test('写进比赛库的改动：按结果计数，没写进去的列出原因', () => {
    const r = 读一晚({ 根: 准备(), 名: '2026-11-01' });
    expect(r.改动).toEqual({ 已写入: 2, 不提交: 1, 待提交: 0, 不提交原因: [{ 表: 'source', 编号: 'source-1', 原因: '字段不合格' }] });
  });
  test('没有 report.md、空的一晚：照样读，方式和结果写“不知道”；不是运行文件夹的名字不读', () => {
    const 根 = 准备();
    expect(读一晚({ 根, 名: '2026-10-31' })).toMatchObject({ 方式: '不知道', 结果: '不知道', 模块们: [], 条目们: [], 搜索词们: [], 候选: null });
    expect(() => 读一晚({ 根, 名: '../外面' })).toThrow(/运行文件夹/);
    expect(() => 读一晚({ 根, 名: '2026-11-01-02' })).toThrow(/run\.db/);
  });
});

describe('读候选网站（给每周统计建议屏蔽的网站用）', () => {
  function 建几晚() {
    const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
    临时.push(根);
    const 建 = (名, 方式, 填) => {
      fs.mkdirSync(path.join(根, 名));
      openRunDb(path.join(根, 名, 'run.db'), { runId: 名 }).close();
      fs.writeFileSync(path.join(根, 名, 'report.md'), `# 当晚总报告\n\n- 方式：${方式}\n`);
      const db = openSqlite(path.join(根, 名, 'run.db'));
      const 条目 = db.prepare("INSERT INTO items (key, kind, status, stage, data, created_by, updated_at) VALUES (?, 'candidate', ?, ?, ?, ?, '2026-10-31T17:00:00Z')");
      const 经过 = db.prepare("INSERT INTO trail (key, module, status, result, reason, at) VALUES (?, ?, ?, '', ?, '2026-10-31T17:00:00Z')");
      填({ 条目, 经过 });
      db.close();
    };
    建('2026-11-01', '正式运行', ({ 条目, 经过 }) => {
      条目.run('https://eol.cn/1', '已丢弃', '03-filter', JSON.stringify({ name: '高考志愿', url: 'https://eol.cn/1' }), '01-search');
      经过.run('https://eol.cn/1', '03-filter', '已丢弃', '03 筛选·标题筛选：不是比赛');
      条目.run('https://a.cn/1', '进行中', '06-ingest', JSON.stringify({ name: '甲杯', url: 'https://a.cn/1' }), '01-search');
      经过.run('https://a.cn/1', '04-extract', '进行中', '抽取完成');
      条目.run('https://school.cn/n', '已丢弃', '03-filter', JSON.stringify({ name: '校内选拔通知', url: 'https://school.cn/n' }), '01-search');
      经过.run('https://school.cn/n', '03-filter', '已丢弃', '03 筛选·Codex代理追踪：已追溯到官方来源 https://xh.org.cn/n，官方来源作为新候选往下走');
      条目.run('https://xh.org.cn/n', '进行中', '04-extract', JSON.stringify({ name: '某某竞赛', url: 'https://xh.org.cn/n' }), '03-filter');   // 追到的官方来源，不是搜到的，不算
      条目.run('https://b.cn/n', '线索', '03-filter', JSON.stringify({ name: '报道', url: 'https://b.cn/n' }), '01-search');
      经过.run('https://b.cn/n', '03-filter', '线索', '03 筛选·Codex代理追踪：找不到官方来源：只有报道');
    });
    建('2026-10-30', '试跑（不写总库）', ({ 条目 }) => { 条目.run('https://eol.cn/9', '进行中', '01-search', '{}', '01-search'); });
    建('2026-10-01', '正式运行', ({ 条目 }) => { 条目.run('https://eol.cn/0', '进行中', '01-search', '{}', '01-search'); });
    return 根;
  }
  test('近 30 天正式跑的每一晚：01 搜到的候选，读没读详情、有没有交追溯、追溯找没找到；试跑的、太早的不算', () => {
    const 几晚 = 读候选网站({ 根: 建几晚(), 天数: 30, now: new Date('2026-11-01T10:00:00Z') });
    expect(几晚.map(n => n.名)).toEqual(['2026-11-01']);
    expect(几晚[0].候选们).toEqual([
      { 网址: 'https://eol.cn/1', 名称: '高考志愿', 读了详情: false, 追溯了: false, 追溯找到: false },
      { 网址: 'https://a.cn/1', 名称: '甲杯', 读了详情: true, 追溯了: false, 追溯找到: false },
      { 网址: 'https://school.cn/n', 名称: '校内选拔通知', 读了详情: false, 追溯了: true, 追溯找到: true },
      { 网址: 'https://b.cn/n', 名称: '报道', 读了详情: false, 追溯了: true, 追溯找到: false },
    ]);
  });
});
