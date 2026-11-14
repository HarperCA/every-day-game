// 维护锁（2026-11-11 线上加，11-12 拉回本地补测试）：维护和新维护共用一把，用 SQLite 写事务占住，进程退出由系统放。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { 拿锁, 流程在跑, 流程锁过期毫秒 } from '../../运行锁.mjs';

const 目录们 = [];
const 新目录 = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), '运行锁-')); 目录们.push(d); return d; };
afterEach(() => { for (const d of 目录们.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('拿锁', () => {
  test('拿到交回放锁的函数；没放之前再拿交回 null；放了能再拿', () => {
    const 目录 = 新目录();
    const 放 = 拿锁(目录);
    expect(typeof 放).toBe('function');
    expect(拿锁(目录)).toBeNull();
    放();
    const 再放 = 拿锁(目录);
    expect(typeof 再放).toBe('function');
    再放();
  });
  test('目录不在就建；锁文件不切换成 WAL（不留 -wal、-shm 文件）', () => {
    const 目录 = path.join(新目录(), '还没有', '维护日志');
    const 放 = 拿锁(目录);
    expect(fs.existsSync(path.join(目录, '.维护中.sqlite'))).toBe(true);
    放();
    expect(fs.readdirSync(目录).filter(f => /-(wal|shm)$/.test(f))).toEqual([]);
  });
  test('不同目录互不影响', () => {
    const 放甲 = 拿锁(新目录());
    const 放乙 = 拿锁(新目录());
    expect(放甲).toBeTypeOf('function');
    expect(放乙).toBeTypeOf('function');
    放甲(); 放乙();
  });
});

describe('流程在跑', () => {
  const now = new Date('2026-11-11T02:00:00.000Z');
  test('锁文件不在：没在跑', () => {
    expect(流程在跑(path.join(新目录(), '.运行中.lock'), { now })).toBe(false);
  });
  test('锁文件在、没超过 12 小时：在跑；超过了算异常留下的，不算在跑', () => {
    const 文件 = path.join(新目录(), '.运行中.lock');
    fs.writeFileSync(文件, JSON.stringify({ pid: 1, at: new Date(now.getTime() - 3600 * 1000).toISOString() }));
    expect(流程在跑(文件, { now })).toBe(true);
    fs.writeFileSync(文件, JSON.stringify({ pid: 1, at: new Date(now.getTime() - 流程锁过期毫秒 - 1).toISOString() }));
    expect(流程在跑(文件, { now })).toBe(false);
  });
});
