// 新维护一批（2026-11-08）：没指定比赛时按调度挑到期的（最多 上限 个），逐个维护；一个出错记下原因接着下一个，AI 额度用完就停。
import { describe, expect, test } from 'vitest';
import { open, seed } from '../../../test/复用/样例数据.mjs';
import { 跑一批, 汇总 } from '../../运行.mjs';

describe('跑一批', () => {
  test('指定了比赛就只跑这些；逐个调维护一个，交回每个的结果', async () => {
    const db = open(); seed(db);
    const 跑过 = [];
    const 回 = await 跑一批({ db, 比赛们: ['event-math', 'event-art'], 维护: async id => { 跑过.push(id); return { 比赛: id, 结果: '没变' }; } });
    expect(跑过).toEqual(['event-math', 'event-art']);
    expect(回.map(x => x.结果)).toEqual(['没变', '没变']);
  });
  test('没指定：按调度挑到期的，最多 上限 个', async () => {
    const db = open(); seed(db);
    const 跑过 = [];
    await 跑一批({ db, 上限: 1, now: () => new Date('2026-11-08T02:00:00Z'), 维护: async id => { 跑过.push(id); return { 比赛: id, 结果: '没变' }; } });
    expect(跑过).toHaveLength(1);
  });
  test('打印每个比赛的成功/失败和摘要（后台显示的文字）', async () => {
    const db = open(); seed(db);
    const 行们 = [];
    await 跑一批({ db, 比赛们: ['event-math', 'event-art'], 并发: 1, 打印: x => 行们.push(x), 维护: async id => id === 'event-math'
      ? { 比赛: id, 结果: '入库', 成功: true, 摘要: '改了 2 处', 原因: '' }
      : { 比赛: id, 结果: '写不出脚本', 成功: false, 摘要: '写不出爬虫脚本', 原因: '3 轮都没写出' } });
    expect(行们).toEqual(['event-math：成功，改了 2 处', 'event-art：失败，写不出爬虫脚本（3 轮都没写出）']);
  });
  test('一个出错记下原因接着跑；AI 额度用完（或余额不足）就停，后面的不跑', async () => {
    const db = open(); seed(db);
    const 回 = await 跑一批({ db, 比赛们: ['event-math', 'event-art'], 维护: async id => { if (id === 'event-math') throw new Error('网页炸了'); return { 比赛: id, 结果: '没变' }; } });
    expect(回).toEqual([{ 比赛: 'event-math', 结果: '出错', 原因: '网页炸了' }, { 比赛: 'event-art', 结果: '没变' }]);
    const 停 = await 跑一批({ db, 比赛们: ['event-math', 'event-art'], 并发: 1, 维护: async () => { throw Object.assign(new Error('额度用完'), { kind: '额度用完' }); } });
    expect(停).toEqual([{ 比赛: 'event-math', 结果: '出错', 原因: '额度用完' }]);
  });
  test.each(['搜索超限', '密钥错误'])('AI 错误种类“%s”也停批', async 种类 => {
    const db = open(); seed(db);
    const 停 = await 跑一批({ db, 比赛们: ['event-math', 'event-art'], 并发: 1, 维护: async () => { throw Object.assign(new Error(种类), { kind: 种类 }); } });
    expect(停).toEqual([{ 比赛: 'event-math', 结果: '出错', 原因: 种类 }]);
  });
  test('并发跑（默认同时 4 个）；结果按名单顺序交回；额度用完后还没开始的不再开始', async () => {
    const db = open(); seed(db);
    let 同时 = 0, 最多 = 0;
    const 名单 = ['a', 'b', 'c', 'd', 'e', 'f'];
    const 慢 = async id => { 同时 += 1; 最多 = Math.max(最多, 同时); await new Promise(r => setTimeout(r, 20)); 同时 -= 1; return { 比赛: id, 结果: '没变' }; };
    const 回 = await 跑一批({ db, 比赛们: 名单, 维护: 慢 });
    expect(最多).toBe(4);
    expect(回.map(x => x.比赛)).toEqual(名单);
    const 开始过 = [];
    const 停 = await 跑一批({ db, 比赛们: 名单, 并发: 2, 维护: async id => { 开始过.push(id); await new Promise(r => setTimeout(r, 10)); if (id === 'a') throw Object.assign(new Error('额度用完'), { kind: '额度用完' }); return { 比赛: id, 结果: '没变' }; } });
    expect(开始过).toEqual(['a', 'b']);
    expect(停.map(x => x.比赛)).toEqual(['a', 'b']);
  });
  // 2026-11-08：判断官网要的“同一域名下有几个比赛”一批只算一次，传给每个维护一个；选项里给了就不算
  test('域名比赛数：一批只算一次，传给每个维护；选项里给了就用给的；名单是空的不算', async () => {
    const db = open(); seed(db);
    const 算过 = [];
    const 数 = new Map([['www.mcm.edu.cn', 1]]);
    const 收到 = [];
    const 维护 = async (id, 选) => { 收到.push(选.域名比赛数); return { 比赛: id, 结果: '没变' }; };
    await 跑一批({ db, 比赛们: ['event-math', 'event-art'], 维护, 算域名比赛数: d => { 算过.push(d); return 数; } });
    expect(算过).toEqual([db]);
    expect(收到).toEqual([数, 数]);
    const 给的 = new Map();
    收到.length = 0;
    await 跑一批({ db, 比赛们: ['event-math'], 维护, 选项: { 域名比赛数: 给的 }, 算域名比赛数: d => { 算过.push(d); return 数; } });
    expect(算过).toHaveLength(1);
    expect(收到).toEqual([给的]);
    await 跑一批({ db, 上限: 0, 维护, 算域名比赛数: d => { 算过.push(d); return 数; } });
    expect(算过).toHaveLength(1);
  });
  // 2026-11-08：维护一个交回 成功/摘要，汇总数成功、失败、出错各几个，再按结果分组
  test('汇总：成功、失败、出错各几个；按结果分组、按摘要分组（出错的摘要算“出错”）', () => {
    const 回 = 汇总([
      { 比赛: 'a', 结果: '没变', 成功: true, 摘要: '没有变化' },
      { 比赛: 'b', 结果: '入库', 成功: true, 摘要: '入库 2 条' },
      { 比赛: 'c', 结果: '写不出脚本', 成功: false, 摘要: '写不出爬虫脚本' },
      { 比赛: 'd', 结果: '出错', 原因: '网页炸了' },
      { 比赛: 'e', 结果: '没变', 成功: true, 摘要: '没有变化' },
    ]);
    expect(回).toEqual({ 共: 5, 成功: 3, 失败: 1, 出错: 1, 按结果: { 没变: 2, 入库: 1, 写不出脚本: 1, 出错: 1 }, 按摘要: { 没有变化: 2, '入库 2 条': 1, 写不出爬虫脚本: 1, 出错: 1 } });
    expect(汇总([])).toEqual({ 共: 0, 成功: 0, 失败: 0, 出错: 0, 按结果: {}, 按摘要: {} });
  });
});
