// 总审核：05 审核的主流程。04 抽取过的候选逐条（并发 4）过：
//   1. 合成记录（common/candidate.mjs）：抽取结果并进候选，用新库的字段名
//   2. 依据来自图片文字识别的：没法逐字核对原网页，不过
//   3. 程序审核（美国/程序审核）：范围闸 → 资料齐不齐 → 收录门槛（判成要人看的经 AI 总管交 DeepSeek 再判）；要“直接收”才算过
//   4. 三项核验（../三项核验/）：读来源网页，Kimi 核对名称、报名时间、报名网址，判专业分类
// 都过了：仍是进行中，data.review 放核验后的记录和核验过的官方来源，交给 06 入库。
// 没过：经 ctx.小数据库.删除 标已丢弃，原因写明是“05 审核·哪一步”（2026-11-01 用户定：过了才入库，不过就不入库，没有待人工审核）。
//   程序审核判“不收”的（不是大学生比赛、水赛）还在改动里记“拒过的网址”，30 天内 02 遇到就扔；
//   资料不齐、证据不足、核验没过、AI 出错的不记，可能只是资料暂时不全或接口出了问题，明晚搜到还会再审。
// AI 出错不截断整晚：到这一步候选已经读过详情、花过额度，只把出错的这一条丢掉并写明原因。
import { createPool } from '../../../../../共用/工具/concurrency.mjs';
import { 审核 as 程序审核 } from '../../../../程序审核/index.mjs';
import { 合成记录 } from '../../../common/candidate.mjs';
import { 拒过改动 } from '../../../common/拒过.mjs';
import { 三项核验 } from '../三项核验/index.mjs';

export const meta = { title: '审核', version: 2 };
export const DEFAULT_PARTS = { 程序审核, 三项核验, 并发: 4 };
export const 模块名 = '05-review';
const 前缀 = 步 => `05 审核·${步}：`;
const 出错 = error => String(error?.message || error).slice(0, 200);

// 抽取时逐字引证过的原文，核验通过后作为来源的原文摘录
const 摘录 = data => Object.values(data.extraction?.fields || {}).filter(f => f && typeof f.quote === 'string' && f.quote).map(f => f.quote).join(' / ');

async function 审一条(item, ctx, parts) {
  const 记录 = 合成记录(item.data);
  const 图片 = item.data.extraction?.imageEvidenceFields || [];
  if (图片.length) return { 丢弃: `${前缀('图片依据')}${图片.join('、')}的依据来自官网图片的文字识别，没法逐字核对原网页` };
  let 程序;
  try {
    程序 = await parts.程序审核(记录, { 关们: ['范围闸', '资料齐不齐', '收录门槛'], ai: ctx.ai, 允许专业待定: true });
  } catch (error) {
    return { 丢弃: `${前缀('收录门槛')}AI 再判出错：${出错(error)}` };
  }
  if (程序.结果 !== '通过') return { 丢弃: `${前缀(程序.停在)}${程序.原因}`, 拒过: 程序.结果 === '不收' };
  const 门槛 = 程序.每关.find(x => x.关 === '收录门槛');
  if (程序.档 !== '直接收') return { 丢弃: `${前缀('收录门槛')}${门槛.原因}${门槛.再判 ? `；AI 再判没有把握：${门槛.再判.理由}` : ''}` };
  let 核验;
  try {
    核验 = await parts.三项核验(记录, ctx, { 摘录: 摘录(item.data) });
  } catch (error) {
    return { 丢弃: `${前缀('三项核验')}调用出错：${出错(error)}` };
  }
  if (!核验.通过) return { 丢弃: `${前缀('三项核验')}${核验.原因}` };
  return { review: { 结果: '通过', 档: 程序.档, 记录: 核验.记录, 来源们: 核验.来源们,
    过程: [...程序.每关.map(x => `${x.关}：${x.原因 || x.结果}`), `三项核验：${核验.原因}`] } };
}

export function createRun(parts = DEFAULT_PARTS) {
  return async function run(input, ctx) {
    const todo = ctx.小数据库.查找({ kind: 'candidate' }).filter(c => c.data?.extraction && !c.data?.review);
    if (!todo.length) {
      ctx.log.info('审核：没有要审核的候选');
      return { items: [], changes: [], problems: [] };
    }
    const pool = createPool({ limit: parts.并发 ?? 4, signal: ctx.signal });
    const 回来 = await pool.map(todo, item => 审一条(item, ctx, parts));
    const 删 = [];
    const changes = [];
    const items = [];
    回来.forEach((r, i) => {
      const item = todo[i];
      const 结果 = r.ok ? r.value : { 丢弃: `${前缀('总审核')}出错：${出错(r.error)}` };
      if (结果.review) {
        items.push({ key: item.key, kind: item.kind, status: '进行中', data: { ...item.data, review: 结果.review }, result: '通过', reason: '程序审核和三项核验都通过' });
        return;
      }
      删.push({ key: item.key, 原因: 结果.丢弃 });
      if (结果.拒过) {
        const change = 拒过改动({ item, 原因: 结果.丢弃, module: 模块名, runId: input.runId, now: ctx.now() });
        if (change) changes.push(change);
      }
    });
    if (删.length) ctx.小数据库.删除(删);
    ctx.log.info(`审核 ${todo.length} 条：通过 ${items.length}，丢弃 ${删.length}（记拒过 ${changes.length}）`);
    return { items, changes, problems: [] };
  };
}

export const run = createRun();
