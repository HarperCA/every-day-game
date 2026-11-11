// 数据库通用部分：不认识任何具体的表，用临时的表和结构文件测打开、升级、只读、删除标记、真删除。不碰仓库里的库。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { buildCreateSql, openDb } from '../../index.mjs';
import { tempRoot } from '../../../test/复用/临时目录.mjs';

const TABLES = { note: { 表名: 'note', 说明: '测试用', 主键: 'id', 字段: {
  id: { 说明: '编号', 必填: true, 类型: '编号' },
  text: { 说明: '内容', 必填: true, 类型: '文字', 最长: 10 },
  version: { 说明: '版本号', 必填: true, 类型: '整数' },
} } };

function structure() {
  const dir = tempRoot('db-engine-');
  fs.writeFileSync(path.join(dir, '001-建表.sql'), buildCreateSql(TABLES));
  return dir;
}

describe('打开库', () => {
  test('不给表和结构就打不开：通用部分不默认任何一个库', () => {
    expect(() => openDb({ file: ':memory:' })).toThrow(expect.objectContaining({ kind: '请求有误' }));
  });
  test('按给的表和结构建库、读写、校验', () => {
    const db = openDb({ file: ':memory:', tables: TABLES, structureDir: structure() });
    db.insert('note', 'n1', { text: '你好' });
    expect(db.get('note', 'n1')).toMatchObject({ version: 1, data: { text: '你好' } });
    expect(() => db.insert('note', 'n2', { text: '超过十个字的一段内容啊' })).toThrow(expect.objectContaining({ kind: '校验不通过' }));
  });
  test('结构文件只补执行一次：同一个库文件第二次打开不会重复建表', () => {
    const dir = structure();
    const file = path.join(tempRoot('db-file-'), 'x.db');
    openDb({ file, tables: TABLES, structureDir: dir }).close();
    fs.writeFileSync(path.join(dir, '002-加索引.sql'), 'CREATE INDEX idx_note_text ON note(text);');
    const db = openDb({ file, tables: TABLES, structureDir: dir });
    expect(db.count('note')).toBe(0);
    db.close();
  });
  test('只读副本：能读，写入一律报“只读副本”', () => {
    const db = openDb({ file: ':memory:', tables: TABLES, structureDir: structure(), readOnly: true });
    expect(db.count('note')).toBe(0);
    expect(() => db.insert('note', 'n1', { text: 'x' })).toThrow(expect.objectContaining({ kind: '只读副本' }));
  });
});

// 带删除标记的表：描述里写 删除标记: 'deleted_at'，这个字段有值就算“已删除”
const MARKED = { card: { 表名: 'card', 说明: '测试用', 主键: 'id', 删除标记: 'deleted_at', 字段: {
  id: { 说明: '编号', 必填: true, 类型: '编号' },
  text: { 说明: '内容', 必填: true, 类型: '文字' },
  deleted_at: { 说明: '删除时间', 必填: false, 类型: '时间' },
  version: { 说明: '版本号', 必填: true, 类型: '整数' },
} } };

function openMarked() {
  const dir = tempRoot('db-marked-');
  fs.writeFileSync(path.join(dir, '001-建表.sql'), buildCreateSql(MARKED));
  const db = openDb({ file: ':memory:', tables: MARKED, structureDir: dir });
  db.insert('card', 'a', { text: '留着' });
  db.insert('card', 'b', { text: '标了删除', deleted_at: '2026-10-01T00:00:00.000Z' });
  return db;
}

describe('删除标记', () => {
  test('默认读不到已删除的：get、list、find、count 都排除', () => {
    const db = openMarked();
    expect(db.get('card', 'b')).toBeNull();
    expect(db.list('card').map(r => r.id)).toEqual(['a']);
    expect(db.find('card', {}).map(r => r.id)).toEqual(['a']);
    expect(db.count('card')).toBe(1);
  });
  test('明确说“包括已删除”才读得到（回收站用）', () => {
    const db = openMarked();
    const all = { 包括已删除: true };
    expect(db.get('card', 'b', all).data.text).toBe('标了删除');
    expect(db.list('card', all).map(r => r.id)).toEqual(['a', 'b']);
    expect(db.find('card', { deleted_at: { isNull: false } }, all).map(r => r.id)).toEqual(['b']);
    expect(db.count('card', {}, all)).toBe(2);
  });
  test('标记和取消标记都用普通的修改；已删除的照样能按编号改（恢复要用）', () => {
    const db = openMarked();
    db.update('card', 'a', { deleted_at: '2026-10-31T00:00:00.000Z' }, 1);
    expect(db.get('card', 'a')).toBeNull();
    db.update('card', 'b', { deleted_at: null }, 1);
    expect(db.get('card', 'b').data.text).toBe('标了删除');
  });
  test('没写删除标记的表不受影响', () => {
    const db = openDb({ file: ':memory:', tables: TABLES, structureDir: structure() });
    db.insert('note', 'n1', { text: 'x' });
    expect(db.get('note', 'n1', { 包括已删除: true }).data.text).toBe('x');
    expect(db.count('note')).toBe(1);
  });
});

describe('真删除', () => {
  test('remove 把这一行从库里彻底删掉；删不存在的报“找不到”', () => {
    const db = openMarked();
    db.remove('card', 'b');
    expect(db.get('card', 'b', { 包括已删除: true })).toBeNull();
    expect(() => db.remove('card', 'b')).toThrow(expect.objectContaining({ kind: '找不到' }));
  });
});

// 通用的删除接口：标删除、取消删除、按“指向”关系连带彻底删除。美国比赛库、北京用户库都用这一套，后台回收站只调它们
const LINKED = {
  team: { 表名: 'team', 说明: '队伍', 主键: 'id', 删除标记: 'deleted_at', 字段: {
    id: { 说明: '编号', 必填: true, 类型: '编号' },
    parent_id: { 说明: '上级队伍', 必填: false, 类型: '编号', 指向: 'team' },
    deleted_at: { 说明: '删除时间', 必填: false, 类型: '时间' },
    deleted_by: { 说明: '谁删的', 必填: false, 类型: '文字' },
    version: { 说明: '版本号', 必填: true, 类型: '整数' },
  } },
  member: { 表名: 'member', 说明: '队员', 主键: 'id', 删除标记: 'deleted_at', 字段: {
    id: { 说明: '编号', 必填: true, 类型: '编号' },
    team_id: { 说明: '属于哪个队', 必填: true, 类型: '编号', 指向: 'team' },
    deleted_at: { 说明: '删除时间', 必填: false, 类型: '时间' },
    version: { 说明: '版本号', 必填: true, 类型: '整数' },
  } },
  score: { 表名: 'score', 说明: '成绩', 主键: 'id', 字段: {
    id: { 说明: '编号', 必填: true, 类型: '编号' },
    member_id: { 说明: '谁的成绩', 必填: true, 类型: '编号', 指向: 'member' },
  } },
};

function openLinked() {
  const dir = tempRoot('db-linked-');
  fs.writeFileSync(path.join(dir, '001-建表.sql'), buildCreateSql(LINKED));
  const db = openDb({ file: ':memory:', tables: LINKED, structureDir: dir, now: () => new Date('2026-10-31T00:00:00.000Z') });
  db.transaction(tx => {
    tx.insert('team', 't1', {});
    tx.insert('team', 't2', { parent_id: 't1' });
    tx.insert('member', 'm1', { team_id: 't1' });
    tx.insert('member', 'm2', { team_id: 't1', deleted_at: '2026-10-01T00:00:00.000Z' });
    tx.insert('score', 's1', { member_id: 'm1' });
    tx.insert('score', 's2', { member_id: 'm2' });
  });
  return db;
}

describe('删除接口', () => {
  test('标记删除：记下删除时间和谁删的（时间可以指定），版本号加一；之后默认读不到', () => {
    const db = openLinked();
    const r = db.标记删除('team', 't2', { by: '管理员' });
    expect(r).toMatchObject({ version: 2, data: { deleted_at: '2026-10-31T00:00:00.000Z', deleted_by: '管理员' } });
    expect(db.get('team', 't2')).toBeNull();
    db.标记删除('member', 'm1', { at: '2026-10-05T00:00:00.000Z' });
    expect(db.get('member', 'm1', { 包括已删除: true }).data.deleted_at).toBe('2026-10-05T00:00:00.000Z');
  });
  test('取消删除：清掉删除标记，又读得到了', () => {
    const db = openLinked();
    db.标记删除('team', 't2', { by: '管理员' });
    db.取消删除('team', 't2');
    expect(db.get('team', 't2').data).toMatchObject({ deleted_at: null, deleted_by: null });
  });
  test('不能标删除的表、不存在的、已经删了的再删、没删的取消：都明确报错', () => {
    const db = openLinked();
    expect(() => db.标记删除('score', 's1')).toThrow(expect.objectContaining({ kind: '请求有误' }));
    expect(() => db.标记删除('team', 'none')).toThrow(expect.objectContaining({ kind: '找不到' }));
    expect(() => db.标记删除('member', 'm2')).toThrow(expect.objectContaining({ kind: '找不到' }));
    expect(() => db.取消删除('team', 't1')).toThrow(expect.objectContaining({ kind: '找不到' }));
  });
  test('彻底删除：按描述里的指向连带删掉指向它的记录（不管标没标删除），指向自己表的改成空，交回连带了什么', () => {
    const db = openLinked();
    const 结果 = db.彻底删除('team', 't1');
    expect(结果).toEqual({ 连带: { member: 2, score: 2 }, 断开: [{ 表: 'team', 编号: 't2', 字段: 'parent_id' }] });
    const 全部 = { 包括已删除: true };
    expect(db.get('team', 't1', 全部)).toBeNull();
    expect(db.count('member', {}, 全部)).toBe(0);
    expect(db.count('score')).toBe(0);
    expect(db.get('team', 't2').data.parent_id).toBeNull();
  });
  test('彻底删除中途出错整个撤回；删不存在的报“找不到”', () => {
    const db = openLinked();
    expect(() => db.彻底删除('team', 'none')).toThrow(expect.objectContaining({ kind: '找不到' }));
    const ro = openDb({ file: ':memory:', tables: LINKED, structureDir: (() => { const d = tempRoot('db-ro-'); fs.writeFileSync(path.join(d, '001-建表.sql'), buildCreateSql(LINKED)); return d; })(), readOnly: true });
    expect(() => ro.彻底删除('team', 't1')).toThrow(expect.objectContaining({ kind: '只读副本' }));
  });
});
