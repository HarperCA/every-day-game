// 补搜索记忆（2026-11-07）：线上库已经建好了，003 加的搜索记忆表是空的；部署后跑一次，给每个比赛写上初始的搜索记忆，已有的不动。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { openDb, 搜索记忆 } from '../../../index.mjs';
import { 补搜索记忆 } from '../../补搜索记忆.mjs';

test('给库文件里没有搜索记忆的比赛补上；试跑不写；库文件不存在不新建', () => {
  const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), '补搜索记忆-'));
  const 库 = path.join(目录, '比赛库.db');
  const db = openDb({ file: 库 });
  db.insert('competition', 'event-a', { name: '甲', level: '国家级', website: 'https://a.edu.cn/' });
  db.insert('competition', 'event-b', { name: '乙', level: '国家级' });
  搜索记忆.写(db, 'event-b', 搜索记忆.初始({}), { 操作人: '新维护' });
  db.close();

  expect(补搜索记忆({ 库, 试跑: true })).toEqual({ 新建: ['event-a'], 已有: 1, 试跑: true });
  expect(补搜索记忆({ 库 })).toEqual({ 新建: ['event-a'], 已有: 1, 试跑: false });
  const 再开 = openDb({ file: 库, readOnly: true });
  expect(搜索记忆.读(再开, 'event-a')).toMatchObject({ 节: { 官方域名: ['a.edu.cn（比赛库官网字段，还没核实）'] }, updated_by: '补搜索记忆' });
  再开.close();
  expect(() => 补搜索记忆({ 库: path.join(目录, '没有.db') })).toThrow('不存在');
  fs.rmSync(目录, { recursive: true, force: true });
});
