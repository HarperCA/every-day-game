// 维护已有记录：审计比赛库里的比赛有没有错误、缺不缺信息，能自己处理的自己处理，实在拿不准的才交给人。
// 和寻找新比赛的流程（../pipeline/）分开，两边不互相引用，只通过比赛库来往。
//
//   runMaintenance({ db, ai, web, checks, find, only, dryRun, log, now, runId, 比赛编号 })
//     给了 比赛编号 时只维护这一个比赛：检查项从 ctx.范围 知道是哪个（轮流维护每次一个，见 轮流.mjs）
//     → { 检查: { 完成, 失败 }, 问题, 处理: { 改正, 人工, 留着 }, 留着, commit }
//
//   1 审计   各项检查同时跑（审计清单.mjs），每项限时，只读比赛库，交回发现的问题
//   2 分流   处理/分流.mjs：错误有把握的改正；拿不准的转人工；缺失的、不知道正确值的去查找（处理/查找/）
//            人工改过的字段（manual_fields）机器不自动改，一律转人工；查找交回 转人工 的，改正照写、同时转人工
//   3 组装   处理/组装.mjs：改正写在记录上并留操作日志；转人工的届次标待人工审核并写明理由；同一条记录合成一次修改
//   4 提交   提交.mjs：一个事务写进比赛库，版本号对不上的跳过
// 已删除的比赛和届次比赛库默认读不到，审计和处理都碰不到它们。
import { createPool } from '../../../共用/工具/concurrency.mjs';
import { CHECKS, loadCheck } from './审计清单.mjs';
import { routeFound, routeProblem } from './处理/分流.mjs';
import { findMissing } from './处理/查找/index.mjs';
import { 组装改动 } from './处理/组装.mjs';
import { commitChanges } from './提交.mjs';

export const FIND_CONCURRENCY = 4;
const notWired = name => new Proxy({}, { get: (_, prop) => () => { throw new Error(`${name}.${String(prop)} 骨架阶段还没接入`); } });
const 文字 = error => String(error?.message || error);

function withTimeout(promise, ms, controller, name) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`检查项 ${name} 超过时间上限 ${Math.round(ms / 1000)} 秒`);
      controller.abort(error);
      reject(error);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// 检查项和查找只能读比赛库
const readOnlyView = db => ({
  get: (...args) => db.get(...args),
  list: (...args) => db.list(...args),
  find: (...args) => db.find(...args),
  count: (...args) => db.count(...args),
});

export async function runMaintenance({ db, ai, web, checks = CHECKS, find = findMissing, only, dryRun = false, log,
  now = () => new Date(), runId = now().toISOString().slice(0, 10), 比赛编号 = null, 报告进度 }) {
  const chosen = only ? checks.filter(c => only.includes(c.name)) : checks;
  if (only && chosen.length !== only.length) throw new Error(`没有这些检查项：${only.filter(n => !checks.some(c => c.name === n)).join('、')}`);
  log.info(`维护开始：${chosen.map(c => c.name).join('、')}${dryRun ? '（试跑，不写比赛库）' : ''}`);
  const view = readOnlyView(db);
  const ctxFor = (name, signal) => ({
    name, log: log.child(name), signal, now, db: view, 范围: 比赛编号 ? { 比赛编号 } : null,
    ai: ai?.session ? ai.session({ source: '维护', runId, module: name }) : (ai || notWired('ai')),
    web: web || notWired('web'),
    报告进度: (阶段, 详情) => { if (!signal?.aborted) 报告进度?.(阶段, 详情); },
  });

  // 1 审计
  const 检查 = { 完成: [], 失败: [] };
  const 问题们 = [];
  await Promise.all(chosen.map(async entry => {
    const controller = new AbortController();
    try {
      const check = await loadCheck(entry);
      const out = await withTimeout(Promise.resolve().then(() => check.run(ctxFor(check.name, controller.signal))), check.timeoutMs || 3600 * 1000, controller, check.name);
      if (!out || !Array.isArray(out.problems)) throw new Error('交回的格式不对：要有 problems 数组');
      问题们.push(...out.problems.map(p => ({ ...p, 检查项: check.name })));
      检查.完成.push(check.name);
      log.info(`${check.name} 完成：发现问题 ${out.problems.length} 个`);
    } catch (error) {
      检查.失败.push({ name: entry.name, error: 文字(error), ...(error?.kind ? { kind: error.kind } : {}) });
      log.warn(`${entry.name} 失败，跳过：${文字(error)}`);
    }
  }));

  报告进度?.('处理审核结果');
  // 2 分流（要查找的并发去查）
  const 改正们 = [];
  const 人工们 = [];
  const 留着 = [];
  const 要查 = [];
  const 回收们 = [];
  const 新增们 = [];
  const 去向 = (p, route) => {
    if (route === '改正') {
      const manual = db.get(p.table, p.key)?.data.manual_fields || [];
      const 碰到人工改过的 = [p.字段, ...Object.keys(p.改动 || {})].some(f => manual.includes(f));
      if (碰到人工改过的) { 人工们.push({ ...p, 人工原因: '人工改过这个字段，机器不自动改' }); return; }
      改正们.push(p);
    } else if (route === '人工') 人工们.push(p);
    else 留着.push(p);
  };
  for (const p of 问题们) {
    if (p.处置 === '新增') { 新增们.push(p); continue; }
    if (!db.get(p.table, p.key)) { 留着.push({ ...p, 说明: `${p.table} ${p.key} 不存在或已删除` }); continue; }
    const route = routeProblem(p);
    if (route === '查找') 要查.push(p);
    else if (route === '回收站') 回收们.push(p);
    else 去向({ ...p, 改动: p.建议改动 }, route);
  }
  const pool = createPool({ limit: FIND_CONCURRENCY });
  const 查到 = await pool.map(要查, p => find(p, ctxFor('查找', undefined)));
  查到.forEach((r, i) => {
    const p = 要查[i];
    if (!r.ok) { 留着.push({ ...p, 说明: `查找出错：${文字(r.error)}` }); return; }
    const found = r.value || {};
    const route = routeFound(found);
    if (route === '留着') { 留着.push({ ...p, 说明: found.说明 || '没找到' }); return; }
    去向({ ...p, 改动: found.改动, 出处: found.出处 || [], 依据: [p.依据, found.说明].filter(Boolean).join('；') }, route);
    // 改正之外还要人看的（比如补到了别的、报名时间还是没有）：同时转人工，理由写查找给的原因
    if (route === '改正' && found.转人工) 人工们.push({ ...p, 改动: {}, 出处: [], 依据: found.转人工 });
  });

  // 3 组装、4 提交
  const { 改动们, 标不了 } = 组装改动({ db, 改正们, 人工们, 回收们, 新增们, now });
  留着.push(...标不了);
  const 处理 = { 改正: 改正们.length, 人工: 人工们.length - 标不了.length, 留着: 留着.length, 回收站: 回收们.length, 新增: 新增们.length };
  log.info(`处理：改正 ${处理.改正}，转人工 ${处理.人工}，留着 ${处理.留着}，回收站 ${处理.回收站}，新增 ${处理.新增}`);
  报告进度?.('保存审核结果');
  const commit = commitChanges({ db, changes: 改动们, log: log.child('提交'), dryRun });
  return { 检查, 问题: 问题们.length, 处理, 留着: 留着.map(p => ({ 检查项: p.检查项, table: p.table, key: p.key, 字段: p.字段, 说明: p.说明 })), commit };
}
