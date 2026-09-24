import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../apps/server/src/db.mjs';
import { createCloudShim, command } from '../apps/server/src/cloudbase-shim.mjs';

// 这层外壳是整个迁移里风险最集中的地方：业务代码一行不改地跑在它上面，
// 它的行为差一点，上面 3757 行的语义就跟着歪。所以这里把云函数实际
// 依赖的每一条语义都钉死。
let dir;
let db;
let cloud;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shim-'));
  db = openDatabase(path.join(dir, 'test.db'));
  cloud = createCloudShim(db);
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('文档读写', () => {
  it('set 之后能读回来，并且带上 _id', async () => {
    const collection = cloud.database().collection('thing');
    await collection.doc('a').set({ data: { name: '甲', n: 1 } });
    const result = await collection.doc('a').get();
    expect(result.data).toEqual({ name: '甲', n: 1, _id: 'a' });
  });

  it('文档不存在时抛 errCode -1，不是返回空', async () => {
    // 云函数里多处靠捕获这个错判断「集合/文档还没建过」——
    // 改成返回 null 会让那些分支静默失效，publicData 首页就会直接报错。
    await expect(cloud.database().collection('thing').doc('missing').get())
      .rejects.toMatchObject({ errCode: -1 });
  });

  it('set 是整体替换，不是合并', async () => {
    const collection = cloud.database().collection('thing');
    await collection.doc('a').set({ data: { keep: 1, drop: 2 } });
    await collection.doc('a').set({ data: { keep: 9 } });
    const { data } = await collection.doc('a').get();
    expect(data).toEqual({ keep: 9, _id: 'a' });
  });

  it('update 是合并，只动传进来的字段', async () => {
    const collection = cloud.database().collection('thing');
    await collection.doc('a').set({ data: { keep: 1, change: 2 } });
    await collection.doc('a').update({ data: { change: 3 } });
    const { data } = await collection.doc('a').get();
    expect(data).toEqual({ keep: 1, change: 3, _id: 'a' });
  });

  it('remove 返回删除条数', async () => {
    const collection = cloud.database().collection('thing');
    await collection.doc('a').set({ data: { x: 1 } });
    expect(await collection.doc('a').remove()).toEqual({ deleted: 1 });
    expect(await collection.doc('a').remove()).toEqual({ deleted: 0 });
  });
});

describe('add 与唯一键冲突', () => {
  it('add 自带 id 时用它，没有就生成一个', async () => {
    const collection = cloud.database().collection('thing');
    const withId = await collection.add({ data: { _id: 'fixed', v: 1 } });
    expect(withId._id).toBe('fixed');
    const generated = await collection.add({ data: { v: 2 } });
    expect(generated._id).toMatch(/^auto-/);
  });

  it('重复 id 抛冲突错——login 靠捕获它处理并发首次登录', async () => {
    const collection = cloud.database().collection('user_account');
    await collection.add({ data: { _id: 'u1', openid: 'o1' } });
    await expect(collection.add({ data: { _id: 'u1', openid: 'o1' } })).rejects.toThrow(/duplicate key/);
  });
});

describe('查询', () => {
  beforeEach(async () => {
    const collection = cloud.database().collection('rec');
    await collection.doc('a').set({ data: { owner: 'u1', score: 3, at: '2026-01-03' } });
    await collection.doc('b').set({ data: { owner: 'u1', score: 1, at: '2026-01-01' } });
    await collection.doc('c').set({ data: { owner: 'u2', score: 2, at: '2026-01-02' } });
  });

  it('where 按字段精确匹配', async () => {
    const { data } = await cloud.database().collection('rec').where({ owner: 'u1' }).get();
    expect(data.map(item => item._id).sort()).toEqual(['a', 'b']);
  });

  it('orderBy 升序降序都对', async () => {
    const asc = await cloud.database().collection('rec').orderBy('score', 'asc').get();
    expect(asc.data.map(item => item._id)).toEqual(['b', 'c', 'a']);
    const desc = await cloud.database().collection('rec').orderBy('at', 'desc').get();
    expect(desc.data.map(item => item._id)).toEqual(['a', 'c', 'b']);
  });

  it('limit 和 skip 能翻页——导出全表时靠它，翻错会静默丢数据', async () => {
    const page1 = await cloud.database().collection('rec').orderBy('score', 'asc').limit(2).get();
    expect(page1.data.map(item => item._id)).toEqual(['b', 'c']);
    const page2 = await cloud.database().collection('rec').orderBy('score', 'asc').skip(2).limit(2).get();
    expect(page2.data.map(item => item._id)).toEqual(['a']);
  });

  it('where 和 orderBy 能串起来用', async () => {
    const { data } = await cloud.database().collection('rec').where({ owner: 'u1' }).orderBy('score', 'desc').get();
    expect(data.map(item => item._id)).toEqual(['a', 'b']);
  });

  it('where().update() 批量改匹配的文档，返回改了几条——sendReminders 的认领/恢复超时靠这个', async () => {
    const result = await cloud.database().collection('rec').where({ owner: 'u1' }).update({ data: { owner: 'u1', tag: 'batched' } });
    expect(result.stats.updated).toBe(2);
    const { data } = await cloud.database().collection('rec').get();
    expect(data.find(item => item._id === 'a').tag).toBe('batched');
    expect(data.find(item => item._id === 'b').tag).toBe('batched');
    expect(data.find(item => item._id === 'c').tag).toBeUndefined(); // 不匹配 where 的不该被动
  });

  it('where().update() 匹配不到任何文档时返回 updated:0，不报错——claimReminder 靠这个判断抢没抢到', async () => {
    const result = await cloud.database().collection('rec').where({ owner: 'nobody' }).update({ data: { tag: 'x' } });
    expect(result.stats.updated).toBe(0);
  });
});

describe('查询操作符', () => {
  beforeEach(async () => {
    const collection = cloud.database().collection('rec');
    await collection.doc('a').set({ data: { kind: 'x', due: 10 } });
    await collection.doc('b').set({ data: { kind: 'y', due: 20 } });
    await collection.doc('c').set({ data: { kind: 'z', due: 30 } });
  });

  it('command.in 匹配任意一个值', async () => {
    const { data } = await cloud.database().collection('rec').where({ kind: command.in(['x', 'z']) }).get();
    expect(data.map(item => item._id).sort()).toEqual(['a', 'c']);
  });

  it('command.lte 取小于等于——提醒扫描靠它筛到期的', async () => {
    const { data } = await cloud.database().collection('rec').where({ due: command.lte(20) }).get();
    expect(data.map(item => item._id).sort()).toEqual(['a', 'b']);
  });

  it('command.inc 在 update 里做累加，不是覆盖', async () => {
    const collection = cloud.database().collection('rec');
    await collection.doc('a').update({ data: { due: command.inc(5) } });
    const { data } = await collection.doc('a').get();
    expect(data.due).toBe(15);
  });

  it('db.command 和导出的 command 是同一个东西', () => {
    expect(cloud.database().command).toBe(command);
  });
});

describe('事务', () => {
  it('成功时全部落盘', async () => {
    const database = cloud.database();
    await database.runTransaction(async transaction => {
      await transaction.collection('t').doc('a').set({ data: { v: 1 } });
      await transaction.collection('t').doc('b').set({ data: { v: 2 } });
    });
    const { data } = await database.collection('t').get();
    expect(data).toHaveLength(2);
  });

  it('中途抛错时整个回滚——saveRecords 的整表替换靠这个保证不写一半', async () => {
    const database = cloud.database();
    await database.collection('t').doc('keep').set({ data: { v: 0 } });
    await expect(database.runTransaction(async transaction => {
      await transaction.collection('t').doc('a').set({ data: { v: 1 } });
      throw new Error('boom');
    })).rejects.toThrow('boom');

    const { data } = await database.collection('t').get();
    expect(data.map(item => item._id)).toEqual(['keep']);
  });
});

describe('没实现的能力要明确报错，不能假装成功', () => {
  it('getWXContext 直接抛错，提示由 HTTP 层注入身份', () => {
    expect(() => cloud.getWXContext()).toThrow(/wx_context_not_available/);
  });

  it('openapi 直接抛错——订阅消息没真发出去，不能静默吞掉', () => {
    expect(() => cloud.openapi).toThrow(/wx_openapi_not_available/);
  });
});
