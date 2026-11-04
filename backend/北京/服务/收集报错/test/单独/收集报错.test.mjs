// 收集报错：搬自上海云函数 clientLog（2026-11-02），去掉云函数的兼容外壳。清洗规则（sanitize.js）原样；
// 存放从云开发的 client_issues 集合改成收集报错自己的库文件（报错日志、统计两张表，字段名照旧）。
// 不放副数据库：副数据库是用户管理中心，每张表都挂在用户下（2026-11-01 定）；报错是匿名的，不属于任何用户。
import { describe, expect, test } from 'vitest';
import { handle } from '../../index.mjs';
import { 打开报错库 } from '../../报错库.mjs';

const NOW = new Date('2026-11-02T02:00:00Z');
const 环境 = () => ({ 报错库: 打开报错库(':memory:'), now: () => NOW });

describe('收集报错', () => {
  test('收下清洗过的上报：只留白名单字段，不存身份；交回存了几条', async () => {
    const env = 环境();
    const r = await handle({ events: [
      { id: 'abc123-xyz', kind: 'load_failed', at: '2026-11-02T01:59:00.000Z', page: 'pages/index/index', message: '超时', elapsedMs: 3200, networkType: '4g', openid: 'o-1', ip: '1.2.3.4' },
      { kind: 'hack' },
    ] }, env);
    expect(r).toEqual({ ok: true, saved: 1 });
    const [行] = env.报错库.全部();
    expect(行).toMatchObject({ kind: 'load_failed', client_id: 'abc123-xyz', at: '2026-11-02T01:59:00.000Z', received_at: NOW.toISOString(), page: 'pages/index/index', message: '超时', elapsed_ms: 3200, networkType: '4g' });
    expect(行).not.toHaveProperty('openid');
    expect(行).not.toHaveProperty('ip');
  });
  test('请求里带了身份（入口给的 openid）也不存：报错是匿名的', async () => {
    const env = { ...环境(), openid: 'o-1' };
    await handle({ events: [{ kind: 'slow' }] }, env);
    expect(JSON.stringify(env.报错库.全部())).not.toContain('o-1');
  });
  test('没有能收的就存 0 条；不是数组不报错', async () => {
    expect(await handle({ events: 'x' }, 环境())).toEqual({ ok: true, saved: 0 });
    expect(await handle({}, 环境())).toEqual({ ok: true, saved: 0 });
  });
});

describe('统计（加载成功次数，公开数据服务按北京时间的日期记）', () => {
  test('每天每个动作加一；没有的那天从 0 开始', () => {
    const 库 = 打开报错库(':memory:');
    库.加一('2026-11-02', 'list');
    库.加一('2026-11-02', 'list');
    库.加一('2026-11-02', 'get');
    库.加一('2026-11-03', 'get');
    expect(库.统计('2026-11-01', '2026-11-03')).toEqual([{ date: '2026-11-02', list: 2, get: 1 }, { date: '2026-11-03', list: 0, get: 1 }]);
    expect(() => 库.加一('2026-11-02', 'drop table')).toThrow('不认识的动作');
  });
});

describe('给用户数据同步读（2026-11-02，报错日志同步一份到美国给后台“访问异常”页）', () => {
  test('之后(编号, 条数)：编号比给的大的报错，带编号、按编号先后；全部统计：每天一行', () => {
    const 库 = 打开报错库(':memory:');
    库.收下([{ kind: 'error', message: '一' }, { kind: 'error', message: '二' }, { kind: 'error', message: '三' }]);
    expect(库.之后(0, 2).map(x => [x.id, x.message])).toEqual([[1, '一'], [2, '二']]);
    expect(库.之后(2, 100).map(x => x.id)).toEqual([3]);
    expect(库.之后(3, 100)).toEqual([]);
    库.加一('2026-11-02', 'list');
    expect(库.全部统计()).toEqual([{ date: '2026-11-02', list: 1, get: 0 }]);
  });
});

describe('搬旧数据用（2026-11-02）', () => {
  test('写统计：某天的加载次数直接写成给的数（不累加），再写覆盖', () => {
    const 库 = 打开报错库(':memory:');
    库.写统计('2026-10-01', 7, 2);
    库.写统计('2026-10-01', 8, 3);
    expect(库.全部统计()).toEqual([{ date: '2026-10-01', list: 8, get: 3 }]);
  });
});
