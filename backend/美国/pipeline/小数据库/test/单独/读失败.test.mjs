// 读失败：给后台“失败任务”页读最近几晚的 run.db，只读（2026-11-01 用户定：失败任务只看）。
// 交回整个模块失败（关键模块失败整晚停下、非关键的跳过）和标成“失败”的条目，各带原因。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { openSqlite } from '../../../../../共用/工具/sqlite.mjs';
import { openRunDb, 读最近失败 } from '../../index.mjs';

const 临时 = [];
afterEach(() => { while (临时.length) fs.rmSync(临时.pop(), { recursive: true, force: true }); });
const NOW = new Date('2026-11-01T10:00:00Z');   // 北京时间 11-01 18:00

function 建一晚(根, 名, 填) {
  const 目录 = path.join(根, 名);
  fs.mkdirSync(目录, { recursive: true });
  openRunDb(path.join(目录, 'run.db'), { runId: 名 }).close();
  const db = openSqlite(path.join(目录, 'run.db'));
  填({
    模块: (name, status, error, at) => db.prepare('INSERT INTO modules (name, status, finished_at, error) VALUES (?, ?, ?, ?)').run(name, status, at, error),
    条目: (key, status, data, 经过们) => {
      db.prepare("INSERT INTO items (key, kind, status, stage, data, created_by, updated_at) VALUES (?, 'candidate', ?, ?, ?, '01-search', ?)").run(key, status, 经过们.at(-1)[0], JSON.stringify(data), 经过们.at(-1)[3]);
      for (const [module, st, reason, at] of 经过们) db.prepare("INSERT INTO trail (key, module, status, result, reason, at) VALUES (?, ?, ?, '', ?, ?)").run(key, module, st, reason, at);
    },
  });
  db.close();
}

function 准备() {
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  临时.push(根);
  建一晚(根, '2026-11-01', ({ 模块, 条目 }) => {
    模块('01-search', '完成', null, '2026-10-31T17:05:00Z');
    模块('04-extract', '跳过', '读网页超时太多', '2026-10-31T17:40:00Z');
    条目('https://a.cn/1', '失败', { name: '某某杯通知', url: 'https://a.cn/1' }, [['01-search', '进行中', '', '2026-10-31T17:05:00Z'], ['04-extract', '失败', '读不到正文：404', '2026-10-31T17:30:00Z']]);
    条目('https://a.cn/2', '已丢弃', { name: '不是比赛', url: 'https://a.cn/2' }, [['03-filter', '已丢弃', '03 筛选·标题筛选：不是比赛', '2026-10-31T17:20:00Z']]);
  });
  建一晚(根, '2026-10-30-02', ({ 模块 }) => { 模块('03-filter', '失败', 'DeepSeek 密钥错误', '2026-10-29T17:10:00Z'); });
  建一晚(根, '2026-10-20', ({ 模块 }) => { 模块('02-dedup', '失败', '太早了，不该读到', '2026-10-19T17:10:00Z'); });
  fs.mkdirSync(path.join(根, '2026-10-31'));             // 没有 run.db 的文件夹（还没跑完就被删了等）跳过
  fs.writeFileSync(path.join(根, '.运行中.lock'), '');    // 不是运行文件夹
  return 根;
}

describe('读最近失败', () => {
  test('最近 7 天：整个模块失败、跳过的模块、失败的条目；已丢弃的不算；太早的不读', () => {
    const 结果 = 读最近失败({ 根: 准备(), 天数: 7, now: NOW });
    expect(结果).toEqual([
      { 哪一晚: '2026-11-01', 时间: '2026-10-31T17:40:00Z', 环节: '04-extract', 对象: '整个模块', 网址: '', 原因: '读网页超时太多', 整晚停下: false },
      { 哪一晚: '2026-11-01', 时间: '2026-10-31T17:30:00Z', 环节: '04-extract', 对象: '某某杯通知', 网址: 'https://a.cn/1', 原因: '读不到正文：404', 整晚停下: false },
      { 哪一晚: '2026-10-30-02', 时间: '2026-10-29T17:10:00Z', 环节: '03-filter', 对象: '整个模块', 网址: '', 原因: 'DeepSeek 密钥错误', 整晚停下: true },
    ]);
  });
  test('天数是 1 时只读今天（北京时间）的；根目录不存在时是空的', () => {
    const 根 = 准备();
    expect(读最近失败({ 根, 天数: 1, now: NOW }).map(r => r.哪一晚)).toEqual(['2026-11-01', '2026-11-01']);
    expect(读最近失败({ 根: path.join(根, '没有'), 天数: 7, now: NOW })).toEqual([]);
  });
  test('打不开的 run.db 记一条，不让整页出错；读的时候不改文件', () => {
    const 根 = 准备();
    fs.mkdirSync(path.join(根, '2026-11-01-02'));
    fs.writeFileSync(path.join(根, '2026-11-01-02', 'run.db'), '不是数据库');
    const 之前 = fs.statSync(path.join(根, '2026-11-01', 'run.db')).mtimeMs;
    const 结果 = 读最近失败({ 根, 天数: 1, now: NOW });
    expect(结果[0]).toMatchObject({ 哪一晚: '2026-11-01-02', 环节: '读运行记录', 对象: 'run.db' });
    expect(fs.statSync(path.join(根, '2026-11-01', 'run.db')).mtimeMs).toBe(之前);
  });
});
