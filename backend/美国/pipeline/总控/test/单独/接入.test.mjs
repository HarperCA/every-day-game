// 接入 AI 总管和读网页：总控给每个模块开一个带身份的 AI 会话（来源、这一晚的编号、模块名），用量按模块记账；
// 跑完让 AI 总管把这一晚的用量汇总存一份；读网页原样交给模块（ctx.web.读网页）。用假的 AI 总管，不连网。
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { createMemoryMainDb } from '../../零件/maindb.mjs';
import { runPipeline } from '../../orchestrator.mjs';
import { empty, fake, tempRoot } from '../../../test/复用/假模块.mjs';

function 假AI总管() {
  const 记 = { 会话们: [], 汇总: [] };
  return { 记, session: 身份 => { 记.会话们.push(身份); return { 身份, chat: async () => ({}), budgetLeft: () => Infinity }; }, usage: { closeRun: runId => { 记.汇总.push(runId); } } };
}

describe('接入 AI 总管和读网页', () => {
  test('每个模块拿到自己的 AI 会话：来源“每晚自动化”、这一晚的编号、模块名', async () => {
    const ai = 假AI总管();
    const 见到 = {};
    const modules = [fake('01-a', (input, ctx) => { 见到.a = ctx.ai.身份; return empty(); }), fake('02-b', (input, ctx) => { 见到.b = ctx.ai.身份; return empty(); })];
    const result = await runPipeline({ logRootDir: tempRoot(), modules, ai });
    const runId = path.basename(result.runDir);
    expect(见到).toEqual({ a: { source: '每晚自动化', runId, module: '01-a' }, b: { source: '每晚自动化', runId, module: '02-b' } });
  });
  test('跑完让 AI 总管把这一晚的用量汇总存一份（停在半路也存，花掉的额度要记得）', async () => {
    const ai = 假AI总管();
    const r1 = await runPipeline({ logRootDir: tempRoot(), modules: [fake('01-a', empty)], ai });
    const r2 = await runPipeline({ logRootDir: tempRoot(), modules: [fake('01-a', () => { throw new Error('x'); }, { critical: true })], ai });
    expect(ai.记.汇总).toEqual([path.basename(r1.runDir), path.basename(r2.runDir)]);
  });
  test('读网页原样交给模块', async () => {
    const web = { 读网页: async () => ({ status: '成功' }) };
    let 见到;
    await runPipeline({ logRootDir: tempRoot(), modules: [fake('01-a', (input, ctx) => { 见到 = ctx.web; return empty(); })], web });
    expect(见到).toBe(web);
  });
  test('屏蔽网站：ctx.屏蔽网站() 交回内置名单加后台确认的（读比赛库的后台状态）；读不到就只用内置名单（2026-11-02）', async () => {
    const mainDb = createMemoryMainDb();
    mainDb.transaction(tx => tx.insert('admin_state', 'site_blocklist', { id: 'site_blocklist', data: { blocked: [{ host: 'eol.cn' }] } }));
    let 见到;
    await runPipeline({ logRootDir: tempRoot(), mainDb, modules: [fake('01-a', (input, ctx) => { 见到 = ctx.屏蔽网站(); return empty(); })] });
    expect(见到).toContain('zhihu.com');
    expect(见到.at(-1)).toBe('eol.cn');
    let 只有内置;
    await runPipeline({ logRootDir: tempRoot(), modules: [fake('01-a', (input, ctx) => { 只有内置 = ctx.屏蔽网站(); return empty(); })] });
    expect(只有内置).toHaveLength(9);
  });
  test('没接 AI 总管时 ctx.ai 一调就报“还没接入”', async () => {
    let 报错;
    await runPipeline({ logRootDir: tempRoot(), modules: [fake('01-a', (input, ctx) => { try { ctx.ai.chat(); } catch (e) { 报错 = e.message; } return empty(); })] });
    expect(报错).toContain('还没接入');
  });
});
