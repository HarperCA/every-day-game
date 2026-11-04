// 04-extract 读详情和抽取：读每个候选的详情页，由 AI 抽取报名时间、参赛对象、主办方等字段，每个字段附原文出处，出处核对不上的删掉。
// 说明见同目录 README.md。这里只管编排：每条候选依次走下面几步，候选之间并发。
//
//   1 读正文      steps/read-source.mjs   读网页读详情页和最多 3 个报名入口、通知、附件链接；读不到：能重试的“顺延”，不能的“失败”
//   2 抽取        steps/extract.mjs       先程序填（steps/程序填.mjs），必要的四项填不齐才交 DeepSeek，逐字核对原文（steps/原文核对.mjs）；正文存进 blobs，条目里只记指纹
//   3 空壳页重读  steps/reread.mjs        正文只有导航骨架时，经 Kimi 读网页（每晚最多 20 条）
//   4 抽空重试    （这里）                 主办方、权威信号、回报一项都没有，再抽一次
//   5 补读        steps/supplement.mjs    参赛对象或报名时间还缺时，读页面里还没读过的通知链接（每晚最多 20 条）
//
// 交回：抽取成功的条目仍是“进行中”，data.extraction 里放结果，交给 05 审核；这个模块不改总库。
// 规矩：只通过 run(input, ctx) 和外面打交道；不 import 别的模块里的文件。
import { createPool } from '../../../../共用/工具/concurrency.mjs';
import { keyFieldCount, missingKeyFields, yieldedNothing } from './rules.mjs';
import { extractFields } from './steps/extract.mjs';
import { readSource } from './steps/read-source.mjs';
import { reread } from './steps/reread.mjs';
import { supplement } from './steps/supplement.mjs';

export const meta = { title: '读详情和抽取', version: 1 };
export const CONCURRENCY = 4;
// 每晚上限，沿用旧代码 run-extract.mjs 的 MAX_RENDERED_REREADS、MAX_SUPPLEMENTS
export const 每晚最多重读 = 20;
export const 每晚最多补读 = 20;
export const DEFAULT_STEPS = { readSource, extractFields, reread, supplement };

// 要抽取的：还在进行中、还没有抽取结果的候选
const needsExtraction = item => item.kind === 'candidate' && !item.data?.extraction;

export function createRun(steps = DEFAULT_STEPS) {
  return async function run(input, ctx) {
    const todo = (input.items || []).filter(needsExtraction);
    const pool = createPool({ limit: CONCURRENCY, signal: ctx.signal });
    const 计数 = { 重读: 0, 补读: 0 };
    const results = await pool.map(todo, item => extractOne(item, ctx, steps, 计数));
    const items = results.map((result, i) => {
      if (result.ok) return result.value;
      const item = todo[i];
      if (ctx.signal?.aborted) return done(item, '顺延', '停止信号：没来得及处理，下一晚接着做');
      return done(item, '失败', `出错：${String(result.error?.message || result.error).slice(0, 200)}`);
    });
    const problems = [];
    const failed = items.filter(item => item.status === '失败').length;
    if (failed) problems.push(`${failed} 条抽取失败`);
    ctx.log.info(`抽取 ${todo.length} 条：成功 ${items.filter(i => i.status === '进行中').length}，顺延 ${items.filter(i => i.status === '顺延').length}，失败 ${failed}`);
    return { items, changes: [], problems };
  };
}

export const run = createRun();

async function extractOne(item, ctx, steps, 计数) {
  // 1 读正文
  const source = await steps.readSource(item, ctx);
  if (!source.ok) return done(item, source.retryable ? '顺延' : '失败', `读不到正文：${source.reason}`);
  let text = source.text;
  const trace = { url: source.url || null, 读过: source.读过 || [], reread: null, retried: false, supplement: null };

  // 2 抽取
  let outcome = await steps.extractFields({ item, text }, ctx);

  // 3 空壳页重读
  if (!outcome.ok && outcome.status === 'page_is_boilerplate') {
    // 先占名额再等：候选之间并发，这样不会超过上限
    if (计数.重读 >= 每晚最多重读) return done(item, '失败', '空壳页：今晚重读已到上限');
    计数.重读 += 1;
    const again = await steps.reread(item, ctx);
    trace.reread = again.ok ? '已重读' : again.reason;
    if (!again.ok) return done(item, '失败', again.reason);
    text = again.text;
    outcome = await steps.extractFields({ item, text }, ctx);
  }
  if (!outcome.ok) return done(item, '失败', `抽取失败：${outcome.reason || outcome.status}`);

  // 4 抽空重试一次
  if (yieldedNothing(outcome.fields)) {
    trace.retried = true;
    const second = await steps.extractFields({ item, text }, ctx);
    if (second.ok && !yieldedNothing(second.fields)) outcome = second;
  }

  // 5 补读正式通知
  const missing = missingKeyFields(outcome.fields);
  if (missing.length && 计数.补读 >= 每晚最多补读) {
    trace.supplement = { missingBefore: missing, used: false, reason: '今晚补读已到上限', missingAfter: missing };
  } else if (missing.length) {
    计数.补读 += 1;
    const extra = await steps.supplement({ item, text, missing, source }, ctx);
    trace.supplement = { missingBefore: missing, used: false, reason: extra.reason || '' };
    if (extra.used) {
      const third = await steps.extractFields({ item, text: extra.text }, ctx);
      if (third.ok && keyFieldCount(third.fields) > keyFieldCount(outcome.fields)) {
        outcome = third;
        text = extra.text;
        trace.supplement = { ...trace.supplement, used: true, noticeUrl: extra.noticeUrl || null };
      }
    }
    trace.supplement.missingAfter = missingKeyFields(outcome.fields);
  }

  const sourceHash = ctx.blobs.put(text, 'text');
  const extraction = {
    fields: outcome.fields,
    dropped: outcome.dropped || [],
    missing: outcome.missing || [],
    promptVersion: outcome.promptVersion || null,
    程序填了: outcome.程序填了 || [],
    AI填了: outcome.AI填了 || [],
    sourceHash,
    ...trace,
  };
  const note = trace.supplement?.missingAfter?.length ? `，仍缺 ${trace.supplement.missingAfter.join('、')}` : '';
  return { ...done(item, '进行中', `抽取完成${note}`), data: { ...item.data, extraction } };
}

function done(item, status, reason) {
  return { key: item.key, kind: item.kind, status, data: item.data || {}, result: status === '进行中' ? '抽取完成' : status, reason };
}
