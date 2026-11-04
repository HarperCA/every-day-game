// 交接：模块的结果不管是交回给总控写、还是自己调 ctx.小数据库 写，都过同一道格式检查（在小数据库里），不合格模块算失败。
// 格式检查本身的单项测试在 小数据库/test/。
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { runPipeline } from '../../orchestrator.mjs';
import { openRunDb } from '../../../小数据库/index.mjs';
import { empty, fake, item, tempRoot } from '../../../test/复用/假模块.mjs';

describe('交接检查', () => {
  test('格式不对的模块算失败，它交回的东西一条都不写进 run.db', async () => {
    const root = tempRoot();
    const modules = [
      fake('01-a', () => ({ items: [item('a')], changes: [], problems: [] })),
      fake('02-bad', () => ({ items: [item('x'), item('x')], changes: [], problems: [] })),
      fake('03-c', empty),
    ];
    const result = await runPipeline({ logRootDir: root, modules });
    expect(result.skipped).toEqual(['02-bad']);
    expect(result.failed[0].error).toContain('重复');
    const rundb = openRunDb(path.join(result.runDir, 'run.db'));
    expect(rundb.item('x')).toBeNull();
    expect(rundb.moduleState('02-bad').status).toBe('跳过');
    rundb.close();
  });

  test('模块自己调 ctx.小数据库.写入结果：总控不再重复写，每条只有一条经过', async () => {
    const root = tempRoot();
    const modules = [
      fake('01-self', async (input, ctx) => { ctx.小数据库.创建当晚({ 搜索词: 2 }); return { 统计: ctx.小数据库.写入结果({ items: [item('a')], changes: [], problems: [] }) }; }),
      fake('02-b', empty),
    ];
    const result = await runPipeline({ logRootDir: root, modules });
    expect(result.ran).toEqual(['01-self', '02-b']);
    const rundb = openRunDb(path.join(result.runDir, 'run.db'));
    expect(rundb.trailOf('a')).toHaveLength(1);
    expect(JSON.parse(rundb.meta('当晚信息'))).toEqual({ 搜索词: 2 });
    rundb.close();
  });
  test('模块经 ctx.小数据库 查找、删除：删掉的不再交给后面的模块，模块照常算完成', async () => {
    const seen = {};
    const modules = [
      fake('01-a', () => ({ items: [item('a'), item('b'), item('c')], changes: [], problems: [] })),
      fake('02-dedup', (input, ctx) => {
        seen.找到 = ctx.小数据库.查找({ kind: 'candidate' }).map(i => i.key);
        ctx.小数据库.删除([{ key: 'a', 原因: '重复' }]);
        ctx.小数据库.标记线索([{ key: 'c', 原因: '竞赛目录' }]);
        return { items: [], changes: [], problems: [] };
      }),
      fake('03-c', (input, ctx) => { seen.后面 = ctx.小数据库.查找().map(i => i.key); return empty(); }),
    ];
    const result = await runPipeline({ logRootDir: tempRoot(), modules });
    expect(result.ran).toEqual(['01-a', '02-dedup', '03-c']);
    expect(seen).toEqual({ 找到: ['a', 'b', 'c'], 后面: ['b'] });
  });
  test('模块删了几条以后出错：它删的全部撤回，什么都不留', async () => {
    const modules = [
      fake('01-a', () => ({ items: [item('a')], changes: [], problems: [] })),
      fake('02-dedup', (input, ctx) => { ctx.小数据库.删除([{ key: 'a', 原因: '重复' }]); throw new Error('DeepSeek 出错'); }),
    ];
    const result = await runPipeline({ logRootDir: tempRoot(), modules });
    expect(result.skipped).toEqual(['02-dedup']);
    const rundb = openRunDb(path.join(result.runDir, 'run.db'));
    expect(rundb.item('a').status).toBe('进行中');
    expect(rundb.trailOf('a')).toHaveLength(1);
    expect(rundb.moduleState('02-dedup').status).toBe('跳过');
    rundb.close();
  });
  test('模块自己写时格式不对：同样算失败，什么都不留', async () => {
    const modules = [fake('01-self', (input, ctx) => ctx.小数据库.写入结果({ items: [item('x'), item('x')] }))];
    const result = await runPipeline({ logRootDir: tempRoot(), modules });
    expect(result.skipped).toEqual(['01-self']);
    const rundb = openRunDb(path.join(result.runDir, 'run.db'));
    expect(rundb.item('x')).toBeNull();
    rundb.close();
  });
});
