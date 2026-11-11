// 失败处理：关键模块失败就停、不提交；非关键模块失败就跳过；超时会触发停止信号；同一时间只能跑一次。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { createMemoryMainDb } from '../../零件/maindb.mjs';
import { runPipeline } from '../../orchestrator.mjs';
import { empty, fake, item, tempRoot } from '../../../test/复用/假模块.mjs';

const insertA = () => ({ items: [item('a')], changes: [{ table: 'competition', key: 'a', op: 'insert', payload: {}, itemKey: 'a' }], problems: [] });

describe('失败处理', () => {
  test('关键模块失败：后面的不跑，总库不动', async () => {
    const mainDb = createMemoryMainDb();
    const ran = [];
    const modules = [
      fake('01-a', insertA),
      fake('02-b', () => { throw new Error('数据库连不上'); }, { critical: true }),
      fake('03-c', () => { ran.push('03'); return empty(); }),
    ];
    const result = await runPipeline({ logRootDir: tempRoot(), modules, mainDb });
    expect(result.stoppedAt).toBe('02-b');
    expect(ran).toEqual([]);
    expect(mainDb.get('competition', 'a')).toBeNull();
    expect(fs.readFileSync(path.join(result.runDir, 'report.md'), 'utf8')).toContain('停在关键模块 02-b');
  });

  test('非关键模块失败：记为跳过，继续跑，最后照样提交', async () => {
    const mainDb = createMemoryMainDb();
    const modules = [
      fake('01-a', insertA),
      fake('02-b', () => { throw new Error('主办方网站打不开'); }),
      fake('03-c', empty),
    ];
    const result = await runPipeline({ logRootDir: tempRoot(), modules, mainDb });
    expect(result.skipped).toEqual(['02-b']);
    expect(result.ran).toEqual(['01-a', '03-c']);
    expect(result.commit.written).toBe(1);
  });

  test('超过时间上限：模块收到停止信号，算失败', async () => {
    let aborted = false;
    const slow = fake('01-slow', (input, ctx) => new Promise(resolve => {
      const timer = setTimeout(() => resolve(empty()), 5000);
      ctx.signal.addEventListener('abort', () => { aborted = true; clearTimeout(timer); resolve(empty()); });
    }), { timeoutMs: 50 });
    const result = await runPipeline({ logRootDir: tempRoot(), modules: [slow, fake('02-b', empty)] });
    expect(aborted).toBe(true);
    expect(result.skipped).toEqual(['01-slow']);
    expect(result.failed[0].error).toContain('时间上限');
  });

  test('同一时间只能跑一次', async () => {
    const root = tempRoot();
    let release;
    const hold = fake('01-hold', () => new Promise(resolve => { release = () => resolve(empty()); }));
    const first = runPipeline({ logRootDir: root, modules: [hold] });
    await new Promise(resolve => setTimeout(resolve, 50));
    await expect(runPipeline({ logRootDir: root, modules: [fake('01-a', empty)] })).rejects.toThrow('已有流程在运行');
    release();
    await first;
    await expect(runPipeline({ logRootDir: root, modules: [fake('01-a', empty)] })).resolves.toBeTruthy();  // 跑完后锁会释放
  });
});
