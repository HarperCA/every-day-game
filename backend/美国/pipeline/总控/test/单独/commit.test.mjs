// 提交：跑完前总库不变；后面的模块能看到前面还没提交的改动；试跑不写；冲突跳过；已丢弃的不写；出错整个撤回；最后由 06 入库的 写入主库 写。
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { createMemoryMainDb } from '../../零件/maindb.mjs';
import { runPipeline } from '../../orchestrator.mjs';
import { openRunDb } from '../../../小数据库/index.mjs';
import { empty, fake, item, tempRoot } from '../../../test/复用/假模块.mjs';

describe('提交', () => {
  test('跑完前总库不变，后面的模块通过 ctx.view 看得到前面还没提交的草稿', async () => {
    const mainDb = createMemoryMainDb();
    const seen = {};
    const modules = [
      fake('01-a', () => ({ items: [item('a')], changes: [{ table: 'competition', key: 'a', op: 'insert', payload: { name: '新草稿' }, itemKey: 'a' }], problems: [] })),
      fake('02-b', (input, ctx) => {
        seen.main = mainDb.get('competition', 'a');
        seen.view = ctx.view('competition', 'a');
        seen.list = ctx.list('competition').map(r => r.key);
        return empty();
      }),
    ];
    const result = await runPipeline({ logRootDir: tempRoot(), modules, mainDb });
    expect(seen.main).toBeNull();
    expect(seen.view.data).toEqual({ name: '新草稿' });
    expect(seen.list).toEqual(['a']);
    expect(result.commit.written).toBe(1);
  });

  test('试跑：模块照跑，总库不写', async () => {
    const mainDb = createMemoryMainDb();
    const modules = [fake('01-a', () => ({ items: [item('a')], changes: [{ table: 'competition', key: 'a', op: 'insert', payload: {}, itemKey: 'a' }], problems: [] }))];
    const result = await runPipeline({ logRootDir: tempRoot(), modules, mainDb, dryRun: true });
    expect(result.commit.wouldWrite).toBe(1);
    expect(mainDb.get('competition', 'a')).toBeNull();
  });

  test('模块从 ctx.dryRun 知道是不是试跑（自己的记录表试跑时不写）', async () => {
    const seen = [];
    const modules = [fake('01-a', (input, ctx) => { seen.push(ctx.dryRun); return empty(); })];
    await runPipeline({ logRootDir: tempRoot(), modules, dryRun: true });
    await runPipeline({ logRootDir: tempRoot(), modules });
    expect(seen).toEqual([true, false]);
  });

  test('流程开始后被人工改过的记录：跳过，不覆盖', async () => {
    const mainDb = createMemoryMainDb({ competition: { c1: { name: '旧名字' } } });
    const modules = [
      fake('01-a', (input, ctx) => {
        const row = ctx.view('competition', 'c1');
        return { items: [{ key: 'c1', kind: 'record', status: '进行中', data: {} }],
          changes: [{ table: 'competition', key: 'c1', op: 'update', payload: { name: '模块改的' }, baseVersion: row.version, itemKey: 'c1' }], problems: [] };
      }),
      fake('02-b', () => { mainDb.touch('competition', 'c1', { name: '你在后台改的' }); return empty(); }),
    ];
    const result = await runPipeline({ logRootDir: tempRoot(), modules, mainDb });
    expect(result.commit.conflicts).toBe(1);
    expect(mainDb.get('competition', 'c1').data).toEqual({ name: '你在后台改的' });
    const rundb = openRunDb(path.join(result.runDir, 'run.db'));
    expect(rundb.changes()[0].reason).toContain('版本号');
    rundb.close();
  });

  test('同一晚对同一行改两次：都按流程开始时的版本核对，不会误判成冲突', async () => {
    const mainDb = createMemoryMainDb({ competition: { c1: { n: 0 } } });
    const change = (n, version) => ({ table: 'competition', key: 'c1', op: 'update', payload: { n }, baseVersion: version });
    const modules = [
      fake('01-a', (input, ctx) => ({ items: [], changes: [change(1, ctx.view('competition', 'c1').version)], problems: [] })),
      fake('02-b', (input, ctx) => ({ items: [], changes: [change(2, ctx.view('competition', 'c1').version)], problems: [] })),
    ];
    const result = await runPipeline({ logRootDir: tempRoot(), modules, mainDb });
    expect(result.commit.written).toBe(2);
    expect(mainDb.get('competition', 'c1').data).toEqual({ n: 2 });
  });

  test('所属条目后来被丢弃：它的改动不写', async () => {
    const mainDb = createMemoryMainDb();
    const modules = [
      fake('01-a', () => ({ items: [item('a')], changes: [{ table: 'competition', key: 'a', op: 'insert', payload: {}, itemKey: 'a' }], problems: [] })),
      fake('02-b', () => ({ items: [item('a', '已丢弃', {}, { reason: '审核不通过' })], changes: [], problems: [] })),
    ];
    const result = await runPipeline({ logRootDir: tempRoot(), modules, mainDb });
    expect(result.commit.written).toBe(0);
    expect(result.commit.rejected).toBe(1);
    expect(mainDb.get('competition', 'a')).toBeNull();
  });

  test('提交中途出错：整个撤回，总库保持原样', async () => {
    const base = createMemoryMainDb();
    let n = 0;
    const mainDb = { ...base, transaction: fn => base.transaction(tx => fn({ ...tx, insert: (...args) => { n += 1; if (n === 2) throw new Error('磁盘满了'); tx.insert(...args); } })) };
    const modules = [fake('01-a', () => ({
      items: [item('a'), item('b')],
      changes: ['a', 'b'].map(key => ({ table: 'competition', key, op: 'insert', payload: {}, itemKey: key })), problems: [],
    }))];
    const result = await runPipeline({ logRootDir: tempRoot(), modules, mainDb });
    expect(result.commit.error).toContain('磁盘满了');
    expect(result.commit.written).toBe(0);
    expect(base.get('competition', 'a')).toBeNull();
  });

  test('跑完以后由 06 入库提供的 写入主库 写进主库：总控只调它，把小数据库、主库、是不是试跑交给它', async () => {
    const 收到 = [];
    const 写入主库 = args => { 收到.push(args); return { total: 0, written: 0, conflicts: 0, rejected: 0, dryRun: args.试跑, error: null }; };
    const mainDb = createMemoryMainDb();
    const result = await runPipeline({ logRootDir: tempRoot(), modules: [fake('01-a', empty)], mainDb, 写入主库, dryRun: true });
    expect(收到).toHaveLength(1);
    expect(收到[0].主库).toBe(mainDb);
    expect(收到[0].试跑).toBe(true);
    expect(typeof 收到[0].小数据库.changes).toBe('function');
    expect(result.commit).toMatchObject({ dryRun: true });
  });
  test('关键模块失败：不写主库', async () => {
    let 调了 = false;
    await runPipeline({ logRootDir: tempRoot(), modules: [fake('01-a', () => { throw new Error('连不上'); }, { critical: true })], 写入主库: () => { 调了 = true; } });
    expect(调了).toBe(false);
  });
});
