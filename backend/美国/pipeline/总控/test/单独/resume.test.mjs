// 接着跑：关键模块失败停下后，修好再接着跑，前面完成的模块不重跑；指定 --from 时撤销后重跑。
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { createMemoryMainDb } from '../../零件/maindb.mjs';
import { runPipeline } from '../../orchestrator.mjs';
import { openRunDb } from '../../../小数据库/index.mjs';
import { empty, fake, item, tempRoot } from '../../../test/复用/假模块.mjs';

describe('接着跑', () => {
  test('停在关键模块后，接着跑只跑没完成的模块，最后照样统一提交', async () => {
    const root = tempRoot();
    const mainDb = createMemoryMainDb();
    const calls = { a: 0, b: 0, c: 0 };
    let broken = true;
    const modules = [
      fake('01-a', () => { calls.a += 1; return { items: [item('a')], changes: [{ table: 'competition', key: 'a', op: 'insert', payload: { n: 1 }, itemKey: 'a' }], problems: [] }; }),
      fake('02-b', () => { calls.b += 1; if (broken) throw new Error('接口连不上'); return empty(); }, { critical: true }),
      fake('03-c', () => { calls.c += 1; return empty(); }),
    ];
    const first = await runPipeline({ logRootDir: root, modules, mainDb });
    expect(first.stoppedAt).toBe('02-b');
    expect(first.commit).toBeNull();
    expect(mainDb.get('competition', 'a')).toBeNull();          // 没跑完，总库不动

    broken = false;
    const second = await runPipeline({ logRootDir: root, modules, mainDb, runDir: first.runDir });
    expect(second.ran).toEqual(['02-b', '03-c']);
    expect(calls).toEqual({ a: 1, b: 2, c: 1 });
    expect(second.commit.written).toBe(1);
    expect(mainDb.get('competition', 'a').data).toEqual({ n: 1 });
  });

  test('--from 重跑：先撤销该模块及之后写过的东西，条目恢复原状', async () => {
    const root = tempRoot();
    let version = 1;
    const modules = [
      fake('01-a', () => ({ items: [item('a', '进行中', { step: 'a' })], changes: [], problems: [] })),
      fake('02-b', () => ({
        items: [item('a', '已丢弃', { step: `b${version}` }), item(`new${version}`)],
        changes: [], problems: [],
      })),
    ];
    const first = await runPipeline({ logRootDir: root, modules, dryRun: true });
    version = 2;
    await runPipeline({ logRootDir: root, modules, runDir: first.runDir, from: '02', dryRun: true });
    const rundb = openRunDb(path.join(first.runDir, 'run.db'));
    expect(rundb.item('new1')).toBeNull();                       // 第一次 02 新建的条目被撤销
    expect(rundb.item('new2')).not.toBeNull();
    expect(rundb.item('a').data).toEqual({ step: 'b2' });
    expect(rundb.trailOf('a').map(t => t.module)).toEqual(['01-a', '02-b']);
    rundb.close();
  });

  test('格式版本不同的 run.db 不能拿来接着跑', async () => {
    const root = tempRoot();
    const first = await runPipeline({ logRootDir: root, modules: [fake('01-a', empty)] });
    const rundb = openRunDb(path.join(first.runDir, 'run.db'));
    rundb.db.prepare("UPDATE meta SET value = '999' WHERE key = 'version'").run();
    rundb.close();
    await expect(runPipeline({ logRootDir: root, modules: [fake('01-a', empty)], runDir: first.runDir })).rejects.toThrow('格式版本');
  });
});
