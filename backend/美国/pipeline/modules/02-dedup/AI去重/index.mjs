// AI 去重：程序去重留下的候选，每批 20 条连同库里全部比赛的名单交给 DeepSeek（经 AI 总管，用途 arbitrate），
// 判断每条是不是库里已有的比赛、是不是和同批前面一条说的是同一个比赛。提示词在 prompt.md，返回格式在 schema.mjs。
//
//   AI去重(候选们, 库, ctx) → { 扔: [{ key, 原因 }], 问题们 }
//
// 扔掉：库里已有且把握 ≥ 0.6；和同批前面一条是同一个比赛且把握 ≥ 0.6。拿不准、新的、把握不够的留下，06 入库时还会再对照。
// 出错就抛错，截断流程（2026-10-31 用户定）：
//   额度不够这一晚要的批数   一次都不调，直接抛错
//   接口调用出错             AI 总管已经自己记下，直接抛错
//   返回的内容用不了         先报告给 AI 总管（ctx.ai.报告问题），再抛错
// 改编自旧的 adminData/dedupeArbitrationAi.js：旧的一次问一对，这里一次问一批、对照库里全部比赛。
// 库里的比赛给 AI 看短号（库1、库2……），AI 回短号，程序换回真正的编号（2026-11-04：线上试跑时 AI 把 event-agent-followup-xxx 抄成 event-xxx，判断是对的，整晚却停了）。
// AI 原样交回真正的编号也认；别的（抄漏的、编的）照旧算用不了，报告并截断。
import { loadPrompt } from '../../../common/prompt.mjs';
import { 检查结果 } from './schema.mjs';

export const 每批 = 20;
export const 最低把握 = 0.6;
export const 用途 = 'arbitrate';
export const 提示词文件 = new URL('./prompt.md', import.meta.url);

const 一行 = (value, n) => String(value || '').replace(/[\s｜]+/g, ' ').trim().slice(0, n);

export async function AI去重(候选们, 库, ctx) {
  if (!候选们.length) return { 扔: [], 问题们: [] };
  const 批们 = [];
  for (let i = 0; i < 候选们.length; i += 每批) 批们.push(候选们.slice(i, i + 每批));
  const 剩 = ctx.ai.budgetLeft?.() ?? Infinity;
  if (批们.length > 剩) throw new Error(`AI 去重额度不够：这一晚要 ${批们.length} 次，只剩 ${剩} 次`);

  const 短号表 = new Map(库.比赛们.map((c, i) => [`库${i + 1}`, c.编号]));
  const 真编号 = 给的 => 短号表.get(给的) ?? 给的;
  const 名单 = 库.比赛们.map((c, i) => [`库${i + 1}`, 一行(c.名称, 200), c.别名们.map(a => 一行(a, 60)).join('、'), c.级别, c.地区].join('｜')).join('\n');
  const 扔 = [];
  for (const 批 of 批们) {
    const 候选行 = 批.map((c, i) => [i + 1, 一行(c.data.name, 200), 一行(c.data.url || c.key, 300), 一行(c.data.snippet, 200)].join('｜')).join('\n');
    const { version, text } = loadPrompt(提示词文件, { 库里的比赛: 名单, 候选: 候选行 });
    const { data } = await ctx.ai.chat({ purpose: 用途, messages: [{ role: 'user', content: text }], json: true, promptVersion: version, signal: ctx.signal });
    const 问题 = 检查结果(data, 批.length, 编号 => Boolean(库.比赛名(真编号(编号))));
    if (问题.length) {
      const 原因 = 问题.join('；');
      ctx.ai.报告问题({ purpose: 用途, promptVersion: version, 原因 });
      throw new Error(`AI 去重返回的内容用不了：${原因}`);
    }
    for (const r of data.结果) {
      const 候选 = 批[r.编号 - 1];
      if (r.把握 < 最低把握) continue;
      if (r.结论 === '库里已有') {
        const 编号 = 真编号(r.比赛编号);
        扔.push({ key: 候选.key, 原因: `AI 判为库里已有：${库.比赛名(编号)}（${编号}）：${r.理由}` });
      }
      else if (r.重复于 != null) 扔.push({ key: 候选.key, 原因: `AI 判为和今晚另一条候选是同一个比赛（${批[r.重复于 - 1].key}）：${r.理由}` });
    }
  }
  扔.sort((a, b) => 候选们.findIndex(c => c.key === a.key) - 候选们.findIndex(c => c.key === b.key));
  return { 扔, 问题们: [] };
}
