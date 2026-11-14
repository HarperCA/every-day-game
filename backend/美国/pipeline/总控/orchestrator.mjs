// 总控：每晚只有这里由定时器启动，后面全部由代码按顺序驱动。
//
//   加锁（同一时间只跑一次）→ 建当晚的运行文件夹和小数据库 run.db
//   → 依次运行每个模块：取进行中的条目交给模块 → 限时运行 → 检查交回的结果 → 一次写进 run.db
//   → 关键模块失败就停下；非关键模块失败记为“跳过”继续
//   → 调 06 入库提供的 写入主库，把小数据库里待写入的写进主库（试跑不写；写进去就是发布，没有验收）→ 写当晚报告 → 解锁
//
// 接着跑：传入已有的运行文件夹 runDir，从第一个没完成的模块开始；
// 指定 from 时，先撤销 from 及之后的模块写过的东西，再从 from 开始重跑。
import fs from 'node:fs';
import path from 'node:path';
import { buildContext } from './零件/context.mjs';
import { 写入主库 as 默认写入主库 } from '../modules/06-ingest/index.mjs';
import { createMemoryMainDb } from './零件/maindb.mjs';
import { loadModule, MODULES } from './零件/modules.mjs';
import { openRunDb } from '../小数据库/index.mjs';
import { writeReport } from './零件/report.mjs';
import { createBudget } from '../../../共用/工具/budget.mjs';
import { createLogger } from '../../../共用/工具/log.mjs';
import { logRoot, nextRunFolder, removeExpiredRuns, runFiles } from '../shared/paths.mjs';

const LOCK_NAME = '.运行中.lock';
const LOCK_STALE_MS = 12 * 3600 * 1000;

function acquireLock(root, now) {
  const file = path.join(root, LOCK_NAME);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: now.toISOString() }), { flag: 'wx' });
      return () => fs.rmSync(file, { force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let held = {};
      try { held = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* 锁文件坏了，当作过期 */ }
      const age = now.getTime() - Date.parse(held.at || 0);
      if (!(age > LOCK_STALE_MS)) throw new Error(`已有流程在运行（进程 ${held.pid}，开始于 ${held.at}），这次不启动`);
      fs.rmSync(file, { force: true });   // 超过 12 小时还没解锁，视为上次异常退出留下的
    }
  }
  throw new Error('拿不到运行锁');
}

function withTimeout(promise, ms, controller, name) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`模块 ${name} 超过时间上限 ${Math.round(ms / 1000)} 秒`);
      controller.abort(error);
      reject(error);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function runPipeline({
  // mainDb：正式运行时 run.mjs 打开真实的比赛库（美国/db）传进来；没传时用内存里的假库，只给测试用（测试不能动真实的库文件）
  modules = MODULES, logRootDir, runDir, from, dryRun = false, mainDb = createMemoryMainDb(),
  ai, web, budgetLimits = {}, 写入主库 = 默认写入主库, now = () => new Date(), console: toConsole = false,
} = {}) {
  const root = logRoot(logRootDir);
  fs.mkdirSync(root, { recursive: true });
  const releaseLock = acquireLock(root, now());
  const result = { runDir: null, ran: [], skipped: [], failed: [], stoppedAt: null, commit: null, dryRun, removedOldRuns: [] };
  let rundb;
  let logger;
  try {
    if (!runDir) {
      result.removedOldRuns = removeExpiredRuns(root, { now: now() });
      runDir = nextRunFolder(root, now());
    }
    fs.mkdirSync(runDir, { recursive: true });
    result.runDir = runDir;
    const files = runFiles(runDir);
    logger = createLogger(files.log, { console: toConsole });
    rundb = openRunDb(files.db, { runId: path.basename(runDir) });
    const startedAt = now();
    logger.info(`开始：运行文件夹 ${runDir}${dryRun ? '（试跑，不写总库）' : ''}`);
    if (result.removedOldRuns.length) logger.info(`删除超过保留期的运行文件夹：${result.removedOldRuns.join('、')}`);

    // 从哪个模块开始
    let start = modules.findIndex(m => !['完成', '跳过'].includes(rundb.moduleState(m.name)?.status));
    if (from) {
      start = modules.findIndex(m => m.name === from || m.name.startsWith(`${from}-`));
      if (start < 0) throw new Error(`没有叫 ${from} 的模块`);
      const redo = modules.slice(start).map(m => m.name).filter(name => rundb.moduleState(name)).reverse();
      if (redo.length) { rundb.clearModules(redo); logger.info(`撤销后重跑：${redo.slice().reverse().join('、')}`); }
    }
    if (start < 0) start = modules.length;

    const budget = createBudget(budgetLimits);
    // 跑一个模块；返回 false 表示关键模块失败，整晚要停下
    const runOne = async entry => {
      const mod = await loadModule(entry);
      const controller = new AbortController();
      rundb.markModule(mod.name, '运行中');
      logger.info(`模块 ${mod.name}（${mod.title || ''}）开始`);
      try {
        // AI 总管：每个模块开一个带身份的会话，用量按“每晚自动化 / 这一晚 / 模块”记账（传进来的不是 AI 总管、没有 session 的原样交给模块，测试用）
        const 会话 = ai?.session ? ai.session({ source: '每晚自动化', runId: path.basename(runDir), module: mod.name }) : ai;
        const ctx = buildContext({ module: mod.name, rundb, mainDb, logger, signal: controller.signal, budget, ai: 会话, web, dryRun, now });
        const input = { runId: path.basename(runDir), module: mod.name, items: rundb.activeItems() };
        const output = await withTimeout(Promise.resolve().then(() => mod.run(input, ctx)), mod.timeoutMs || 3600 * 1000, controller, mod.name);
        // 模块自己经 ctx.小数据库 写过结果的，不再写；交回结果的，由总控调同一个写入接口写（都过格式检查）
        const stats = rundb.已写入(mod.name) ? rundb.moduleStates().find(m => m.name === mod.name).stats : rundb.写入结果(mod.name, output);
        result.ran.push(mod.name);
        logger.info(`模块 ${mod.name} 完成：处理 ${stats.items} 条，提出改动 ${stats.changes} 条${stats.problems.length ? `，问题 ${stats.problems.length} 个` : ''}`);
        return true;
      } catch (error) {
        const message = String(error?.message || error);
        // 模块中途经 ctx.小数据库 删过的条目，按经过撤回，失败的模块什么都不留
        rundb.clearModules([mod.name]);
        result.failed.push({ name: mod.name, error: message, critical: Boolean(mod.critical) });
        if (mod.critical) {
          rundb.markModule(mod.name, '失败', { error: message });
          logger.error(`关键模块 ${mod.name} 失败，整晚停下，不提交：${message}`);
          result.stoppedAt = mod.name;
          return false;
        }
        rundb.markModule(mod.name, '跳过', { error: message });
        result.skipped.push(mod.name);
        logger.warn(`模块 ${mod.name} 失败，跳过继续：${message}`);
        return true;
      }
    };

    const todo = modules.slice(start);
    for (const entry of todo) {
      if (!await runOne(entry)) break;
    }
    if (!result.stoppedAt) {
      result.commit = 写入主库({ 小数据库: rundb, 主库: mainDb, log: logger.child('写入主库'), 试跑: dryRun, 复核: true, now: now() });
    } else {
      logger.warn('流程没跑完，这一晚不提交，修好后可以从停下的模块接着跑');
    }
    // 这一晚花掉的接口额度，不管跑没跑完都让 AI 总管汇总存一份
    if (ai?.usage?.closeRun) {
      try { ai.usage.closeRun(path.basename(runDir)); } catch (error) { logger.warn(`AI 用量汇总没存上：${error?.message || error}`); }
    }
    writeReport(files.report, { runId: path.basename(runDir), startedAt, finishedAt: now(), dryRun, modules, rundb, result });
    logger.info(`结束：报告 ${files.report}`);
    return { ...result, statusCounts: rundb.statusCounts() };
  } catch (error) {
    logger?.error(`总控出错：${error?.message || error}`);
    throw error;
  } finally {
    rundb?.close();
    releaseLock();
  }
}
