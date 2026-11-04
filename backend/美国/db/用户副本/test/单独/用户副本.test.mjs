// 用户副本：北京用户库（和报错库）同步到美国的只读副本（2026-11-02，用户定用户数据传回美国）。
// 不照抄北京的表：一张通用表按“表 + 编号”存一行的内容，北京改了表结构美国不用跟着改；后台按表读出来自己整理。
// 只有同步（沟通/用户数据同步/美国端.mjs）写；后台用 readOnly 打开，写不进去。
import fs from 'node:fs';
import { describe, expect, test } from 'vitest';
import { FIRST_FILE, buildCopySql } from '../../结构/生成.mjs';
import { 用户副本 } from '../../../index.mjs';

const NOW = new Date('2026-11-02T02:00:00Z');
const 开 = (选项 = {}) => 用户副本.open({ file: ':memory:', now: () => NOW, ...选项 });

describe('用户副本', () => {
  test('写进去、按表列出、按编号取一条；同一条再写就覆盖', () => {
    const db = 开();
    用户副本.写(db, [{ 表: 'favorite', 编号: 'f1', data: { user_id: 'u1', competition_id: 'event-math' } }, { 表: 'user_account', 编号: 'u1', data: { status: 'active' } }], { now: NOW });
    用户副本.写(db, [{ 表: 'favorite', 编号: 'f1', data: { user_id: 'u1', competition_id: 'event-art' } }], { now: NOW });
    expect(用户副本.列出(db, 'favorite')).toEqual([{ user_id: 'u1', competition_id: 'event-art' }]);
    expect(用户副本.一条(db, 'user_account', 'u1')).toEqual({ status: 'active' });
    expect(用户副本.一条(db, 'user_account', 'u-没有')).toBeNull();
    expect(用户副本.条数(db)).toEqual({ favorite: 1, user_account: 1 });
  });
  test('删：按表和编号删，没有的不报错', () => {
    const db = 开();
    用户副本.写(db, [{ 表: 'favorite', 编号: 'f1', data: {} }, { 表: 'favorite', 编号: 'f2', data: {} }], { now: NOW });
    expect(用户副本.删(db, [{ 表: 'favorite', 编号: 'f1' }, { 表: 'favorite', 编号: 'f-没有' }])).toBe(1);
    expect(用户副本.条数(db)).toEqual({ favorite: 1 });
  });
  test('整体重推收尾：这一轮没写到的（北京已经没有了）清掉', () => {
    const db = 开();
    用户副本.写(db, [{ 表: 'favorite', 编号: 'f1', data: {} }, { 表: 'favorite', 编号: 'f2', data: {} }], { now: NOW });
    用户副本.写(db, [{ 表: 'favorite', 编号: 'f2', data: {} }], { now: NOW, 轮次: 'r-1' });
    expect(用户副本.收尾(db, 'r-1')).toBe(1);
    expect(用户副本.列出(db, 'favorite')).toHaveLength(1);
  });
  test('不认识的表不收；只读打开写不进去', () => {
    const db = 开();
    expect(() => 用户副本.写(db, [{ 表: 'secret', 编号: 'x', data: {} }], { now: NOW })).toThrow();
    expect(() => 用户副本.写(开({ readOnly: true }), [{ 表: 'favorite', 编号: 'f1', data: {} }], { now: NOW })).toThrow('只读副本');
  });
});

test('001-建表.sql 和描述生成的一致', () => expect(fs.readFileSync(FIRST_FILE, 'utf8')).toBe(buildCopySql()));
