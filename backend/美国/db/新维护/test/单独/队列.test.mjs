// 新维护的队列模式（2026-11-12 用户定：旧 AI 审查删掉，后台手动勾选的比赛改由新维护处理，可以选任意数量）。
//   跑队列：从维护队列逐个领，并发维护一个，做完标完成/失败；额度类错误停批，没做完的留在队列，写 2 小时暂停。
//   运行队列：定时器每 2 分钟调一次；队列空的不拿锁直接退出；每晚流程在跑、维护锁被占（每日新维护在跑）就跳过这一轮。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { open, seed } from '../../../test/复用/样例数据.mjs';
import { tempRoot } from '../../../../../共用/test/复用/临时目录.mjs';
import { 拿锁 } from '../../../../../共用/工具/运行锁.mjs';
import { 维护队列 } from '../../../index.mjs';
import { 跑队列, 运行队列 } from '../../运行.mjs';

const 起点 = new Date('2026-11-12T02:00:00.000Z');
const now = () => 起点;
const 不算 = () => new Map();   // 域名比赛数：测试里不全表统计

function 库(个数 = 0) {
  const db = open(); seed(db);
  db.transaction(tx => { for (let i = 1; i <= 个数; i += 1) tx.insert('competition', `event-q${i}`, { name: `队列比赛${i}`, level: '国家级' }); });
  return db;
}
const 编号们 = 个数 => Array.from({ length: 个数 }, (_, i) => `event-q${i + 1}`);
const 额度错误 = () => Object.assign(new Error('Codex 额度用完'), { kind: '额度用完' });

describe('跑队列', () => {
  test('任意数量：排了 150 个，一次运行全部处理完，同时最多 4 个；做完队列空了，每个都记进最近（最近只留 30 个）', async () => {
    const db = 库(150);
    维护队列.加入(db, 编号们(150));
    let 同时 = 0, 最多 = 0;
    const 跑过 = [];
    const 维护 = async id => {
      同时 += 1; 最多 = Math.max(最多, 同时);
      await new Promise(r => setTimeout(r, 1));
      同时 -= 1; 跑过.push(id);
      return { 比赛: id, 结果: '没变', 成功: true, 摘要: '没有变化' };
    };
    const 回 = await 跑队列({ db, now, 维护, 算域名比赛数: 不算 });
    expect(跑过).toHaveLength(150);
    expect(new Set(跑过).size).toBe(150);
    expect(最多).toBe(4);
    expect(回.结果们).toHaveLength(150);
    expect(回.停因).toBe('');
    const 队列 = 维护队列.读(db);
    expect(队列.排队).toEqual([]);
    expect(队列.正在).toEqual([]);
    expect(队列.最近).toHaveLength(30);
  });
  test('并发沿用参数；运行中新排进来的也接着处理，直到队列空', async () => {
    const db = 库(5);
    维护队列.加入(db, 编号们(3));
    const 跑过 = [];
    const 维护 = async id => {
      if (id === 'event-q1') 维护队列.加入(db, ['event-q4', 'event-q5']);
      跑过.push(id);
      return { 比赛: id, 结果: '没变', 成功: true, 摘要: '没有变化' };
    };
    await 跑队列({ db, now, 并发: 1, 维护, 算域名比赛数: 不算 });
    expect(跑过).toEqual(编号们(5));
    expect(维护队列.读(db).排队).toEqual([]);
  });
  test('成功、失败、出错都标在队列的最近里：成功看维护一个交回的 成功；一般的异常算失败“出错”，接着下一个', async () => {
    const db = 库(3);
    维护队列.加入(db, 编号们(3));
    const 维护 = async id => {
      if (id === 'event-q1') return { 比赛: id, 结果: '入库', 成功: true, 摘要: '改了 2 处', 原因: '' };
      if (id === 'event-q2') return { 比赛: id, 结果: '没找到官网', 成功: false, 摘要: '没找到官网', 原因: 'DeepSeek 没找到' };
      throw new Error('网页炸了');
    };
    const 行们 = [];
    const 回 = await 跑队列({ db, now, 并发: 1, 维护, 打印: x => 行们.push(x), 算域名比赛数: 不算 });
    expect(回.结果们.map(x => x.比赛)).toEqual(编号们(3));
    const 最近 = Object.fromEntries(维护队列.读(db).最近.map(x => [x.比赛编号, x]));
    expect(最近['event-q1']).toMatchObject({ 成功: true, 摘要: '改了 2 处', 结果: '入库' });
    expect(最近['event-q2']).toMatchObject({ 成功: false, 摘要: '没找到官网', 原因: 'DeepSeek 没找到' });
    expect(最近['event-q3']).toMatchObject({ 成功: false, 摘要: '出错', 结果: '出错', 原因: '网页炸了' });
    expect(行们).toEqual(['event-q1：成功，改了 2 处', 'event-q2：失败，没找到官网（DeepSeek 没找到）', 'event-q3：出错 网页炸了']);
  });
  test('AI 额度用完：停这一批，出错的放回排队最前，还没开始的留在队列；写 2 小时暂停', async () => {
    const db = 库(5);
    维护队列.加入(db, 编号们(5));
    const 开始过 = [];
    const 维护 = async id => {
      开始过.push(id);
      if (id === 'event-q2') throw 额度错误();
      return { 比赛: id, 结果: '没变', 成功: true, 摘要: '没有变化' };
    };
    const 回 = await 跑队列({ db, now, 并发: 1, 维护, 算域名比赛数: 不算 });
    expect(开始过).toEqual(['event-q1', 'event-q2']);
    expect(回.停因).toMatch(/额度/);
    const 队列 = 维护队列.读(db);
    expect(队列.排队).toEqual(['event-q2', 'event-q3', 'event-q4', 'event-q5']);
    expect(队列.正在).toEqual([]);
    expect(队列.最近.map(x => x.比赛编号)).toEqual(['event-q1']);
    expect(维护队列.生效暂停(db, 起点)).toMatchObject({ reason: expect.stringContaining('额度用完') });
  });
  test('余额不足（DeepSeek 402，按文字认）也停批；同时在跑的跑完照常标完成', async () => {
    const db = 库(6);
    维护队列.加入(db, 编号们(6));
    const 开始过 = [];
    const 维护 = async id => {
      开始过.push(id);
      await new Promise(r => setTimeout(r, id === 'event-q1' ? 5 : 20));
      if (id === 'event-q1') throw new Error('DeepSeek 402 Insufficient Balance 余额不足');
      return { 比赛: id, 结果: '没变', 成功: true, 摘要: '没有变化' };
    };
    await 跑队列({ db, now, 并发: 2, 维护, 算域名比赛数: 不算 });
    expect(开始过).toEqual(['event-q1', 'event-q2']);
    const 队列 = 维护队列.读(db);
    expect(队列.排队).toEqual(['event-q1', 'event-q3', 'event-q4', 'event-q5', 'event-q6']);
    expect(队列.最近.map(x => x.比赛编号)).toEqual(['event-q2']);
    expect(维护队列.生效暂停(db, 起点)).not.toBeNull();
  });
  test('暂停还没到点：这一轮不跑，队列不动；到点后照常跑，有成功的清掉暂停', async () => {
    const db = 库(2);
    维护队列.加入(db, 编号们(2));
    维护队列.暂停(db, '额度用完', { now: 起点 });
    const 跑过 = [];
    const 维护 = async id => { 跑过.push(id); return { 比赛: id, 结果: '没变', 成功: true, 摘要: '没有变化' }; };
    const 回 = await 跑队列({ db, now, 维护, 算域名比赛数: 不算 });
    expect(跑过).toEqual([]);
    expect(回.停因).toMatch(/暂停到/);
    expect(维护队列.读(db).排队).toEqual(编号们(2));
    const 三小时后 = () => new Date(起点.getTime() + 3 * 3600 * 1000);
    await 跑队列({ db, now: 三小时后, 维护, 算域名比赛数: 不算 });
    expect(跑过).toEqual(编号们(2));
    expect(维护队列.读暂停(db)?.pausedUntil ?? null).toBeNull();
  });
  test('上次异常退出留下的“正在”先收回，再处理', async () => {
    const db = 库(2);
    维护队列.加入(db, 编号们(2));
    维护队列.领下一个(db, { at: 起点.toISOString() });   // 假装上次跑到一半进程没了
    const 跑过 = [];
    await 跑队列({ db, now, 并发: 1, 维护: async id => { 跑过.push(id); return { 比赛: id, 结果: '没变', 成功: true, 摘要: '没有变化' }; }, 算域名比赛数: 不算 });
    expect(跑过).toEqual(编号们(2));
    expect(维护队列.读(db).正在).toEqual([]);
  });
  test('每晚流程开始了（该停）：不再领新的，剩下的留在队列', async () => {
    const db = 库(4);
    维护队列.加入(db, 编号们(4));
    let 跑了 = 0;
    const 回 = await 跑队列({ db, now, 并发: 1, 该停: () => 跑了 >= 2, 维护: async id => { 跑了 += 1; return { 比赛: id, 结果: '没变', 成功: true, 摘要: '没有变化' }; }, 算域名比赛数: 不算 });
    expect(跑了).toBe(2);
    expect(回.停因).toMatch(/每晚流程/);
    expect(维护队列.读(db).排队).toEqual(['event-q3', 'event-q4']);
  });
  test('域名比赛数一轮只算一次，传给每个维护一个；选项（ai、工具、屏蔽）照传；队列空的不算', async () => {
    const db = 库(2);
    维护队列.加入(db, 编号们(2));
    const 算过 = [];
    const 数 = new Map([['x.cn', 1]]);
    const 收到 = [];
    await 跑队列({ db, now, 选项: { 屏蔽: ['a.com'] }, 维护: async (id, 选) => { 收到.push([选.域名比赛数, 选.屏蔽, 选.db]); return { 比赛: id, 结果: '没变', 成功: true }; }, 算域名比赛数: d => { 算过.push(d); return 数; } });
    expect(算过).toEqual([db]);
    expect(收到).toEqual([[数, ['a.com'], db], [数, ['a.com'], db]]);
    await 跑队列({ db, now, 维护: async () => ({}), 算域名比赛数: d => { 算过.push(d); return 数; } });
    expect(算过).toHaveLength(1);
  });
});

describe('运行队列（定时器每 2 分钟一次）', () => {
  const 准备 = () => {
    const 目录 = tempRoot('maintain-queue-');
    return { 锁目录: path.join(目录, '锁'), 流程锁: path.join(目录, '流程', '.运行中.lock') };
  };
  test('队列空的：不拿锁、不打印、不跑', async () => {
    const { 锁目录, 流程锁 } = 准备();
    const 行们 = [];
    let 跑了 = false;
    const 回 = await 运行队列({ 锁目录, 流程锁, 有活: () => false, 跑: async () => { 跑了 = true; }, 打印: x => 行们.push(x) });
    expect(回).toMatchObject({ 跑了: false, 原因: '队列空' });
    expect(跑了).toBe(false);
    expect(行们).toEqual([]);
    expect(fs.existsSync(锁目录)).toBe(false);
  });
  test('锁被占（每日新维护或上一轮队列还在跑）：这一轮跳过，下次再看', async () => {
    const { 锁目录, 流程锁 } = 准备();
    const 放 = 拿锁(锁目录);
    try {
      const 行们 = [];
      let 跑了 = false;
      const 回 = await 运行队列({ 锁目录, 流程锁, 有活: () => true, 跑: async () => { 跑了 = true; }, 打印: x => 行们.push(x) });
      expect(回).toMatchObject({ 跑了: false, 原因: '锁被占' });
      expect(跑了).toBe(false);
      expect(行们.join('')).toMatch(/跳过/);
    } finally { 放(); }
  });
  test('每晚流程在跑：跳过', async () => {
    const { 锁目录, 流程锁 } = 准备();
    fs.mkdirSync(path.dirname(流程锁), { recursive: true });
    fs.writeFileSync(流程锁, JSON.stringify({ at: new Date().toISOString() }));
    let 跑了 = false;
    const 回 = await 运行队列({ 锁目录, 流程锁, 有活: () => true, 跑: async () => { 跑了 = true; }, 打印: () => {} });
    expect(回).toMatchObject({ 跑了: false, 原因: '流程在跑' });
    expect(跑了).toBe(false);
  });
  test('拿到锁就跑，跑完放锁（下一轮能再拿到）；跑的时候锁一直占着', async () => {
    const { 锁目录, 流程锁 } = 准备();
    let 跑时别人拿得到 = null;
    const 回 = await 运行队列({ 锁目录, 流程锁, 有活: () => true, 跑: async () => { 跑时别人拿得到 = 拿锁(锁目录) !== null; return { 结果们: [1, 2] }; }, 打印: () => {} });
    expect(回).toMatchObject({ 跑了: true, 结果们: [1, 2] });
    expect(跑时别人拿得到).toBe(false);
    const 放 = 拿锁(锁目录);
    expect(放).not.toBeNull();
    放();
  });
});
