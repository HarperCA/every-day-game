// 整条流程：6 个模块（大多是占位）能从头跑到尾；条目按状态一步步往下传，已丢弃的不再交给后面的模块。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { createMemoryMainDb } from '../../零件/maindb.mjs';
import { MODULES } from '../../零件/modules.mjs';
import { runPipeline } from '../../orchestrator.mjs';
import { openRunDb } from '../../../小数据库/index.mjs';
import { beijingDate } from '../../../shared/paths.mjs';
import { empty, fake, item, tempRoot } from '../../../test/复用/假模块.mjs';

describe('整条流程', () => {
  test('6 个模块：通知追溯并进 03 筛选，验收去掉，入库写进主库就是发布（2026-11-01 用户定）；去重、筛选、审核、入库是关键模块', () => {
    expect(MODULES.map(m => m.name)).toEqual(['01-search', '02-dedup', '03-filter', '04-extract', '05-review', '06-ingest']);
    expect(MODULES.some(m => 'afterCommit' in m)).toBe(false);
    expect(MODULES.filter(m => m.critical).map(m => m.name)).toEqual(['01-search', '02-dedup', '03-filter', '05-review', '06-ingest']);
  });
  test('6 个模块从头跑到尾，生成 run.db、run.log、report.md', async () => {
    const root = tempRoot();
    const result = await runPipeline({ logRootDir: root });
    expect(result.ran).toEqual(MODULES.map(m => m.name));
    expect(result.stoppedAt).toBeNull();
    expect(path.basename(result.runDir)).toBe(beijingDate());
    for (const file of ['run.db', 'run.log', 'report.md']) expect(fs.existsSync(path.join(result.runDir, file))).toBe(true);
    expect(fs.readFileSync(path.join(result.runDir, 'report.md'), 'utf8')).toContain('全部模块跑完');
  });

  test('条目一步步往下传：已丢弃的不再交给后面的模块，每一步都留下去向', async () => {
    const root = tempRoot();
    const mainDb = createMemoryMainDb();
    const seen = {};
    const modules = [
      fake('01-a', () => ({ items: [item('a'), item('b'), item('c')], changes: [{ table: 'competition', key: 'a', op: 'insert', payload: { name: 'A 赛' }, itemKey: 'a' }], problems: [] })),
      fake('02-b', input => {
        seen.b = input.items.map(i => i.key);
        return { items: [item('b', '已丢弃', {}, { reason: '判重：库里已有' })], changes: [], problems: [] };
      }),
      fake('03-c', input => { seen.c = input.items.map(i => i.key); return empty(); }),
    ];
    const result = await runPipeline({ logRootDir: root, modules, mainDb });
    expect(seen.b).toEqual(['a', 'b', 'c']);
    expect(seen.c).toEqual(['a', 'c']);
    expect(result.commit.written).toBe(1);
    expect(mainDb.get('competition', 'a').data).toEqual({ name: 'A 赛' });
    const rundb = openRunDb(path.join(result.runDir, 'run.db'));
    expect(rundb.trailOf('b').map(t => [t.module, t.status, t.reason])).toEqual([['01-a', '进行中', ''], ['02-b', '已丢弃', '判重：库里已有']]);
    rundb.close();
  });

  test('同一天再跑一次，运行文件夹加序号，不覆盖第一次的结果', async () => {
    const root = tempRoot();
    const first = await runPipeline({ logRootDir: root, modules: [fake('01-a', empty)] });
    const second = await runPipeline({ logRootDir: root, modules: [fake('01-a', empty)] });
    expect(path.basename(second.runDir)).toBe(`${path.basename(first.runDir)}-02`);
  });
});
