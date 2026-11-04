// Jev 筛选：标题筛选看不出来的候选，每条经 AI 总管的 decide（用途 classify → Jev）问一次是哪一类页面，按概率分去向。
// 给筛选总管提供函数。分去向的规则搬自 crawler/lib/jevCandidateFilter.mjs 的 decideByProbabilities（2026-10-01 起的规则，不变）。
//
//   Jev筛选(候选们, ctx) → [{ key, 去向: '扔' | '线索' | '读详情' | '追溯', 类别, 概率, 原因 }]
//
// 出错就抛错，截断流程（和 02 对比去重一样）：额度不够一次都不调；调用出错直接抛（AI 总管已经记下）；
// 返回的概率用不了先 ctx.ai.报告问题 再抛。
import { createPool } from '../../../../../共用/工具/concurrency.mjs';
import { 版本, 类别们, 题目 } from './题目.mjs';

export const 用途 = 'classify';
export const 并发 = 4;
export const 无关就扔 = 0.5;
export const 无关留线索 = 0.2;

const 百分 = v => `${Math.round(v * 100)}%`;

// 不看“第一名的概率够不够”，看“是不是赛事相关页面”和“哪一组更像”：几类本来互相重叠，概率会被分摊
export function 按概率分(概率 = {}) {
  const p = name => Number(概率[name]) || 0;
  const 无关 = p('unrelated');
  if (无关 > 无关就扔) return { 去向: '扔', 原因: `Jev 认为与赛事无关的概率 ${百分(无关)}` };
  if (无关 >= 无关留线索) return { 去向: '线索', 原因: `只留线索：Jev 认为与赛事无关的概率 ${百分(无关)}，拿不准` };
  const 官方 = p('competition_site') + p('registration_entry') + p('organizer_notice');
  const 转载 = p('repost_or_school_selection') + p('news_or_result');
  const 目录 = p('directory_lead');
  const 明细 = `与赛事无关仅 ${百分(无关)}；官网/报名入口/主办方通知合计 ${百分(官方)}，转载/新闻合计 ${百分(转载)}`;
  if (目录 > 官方 && 目录 > 转载) return { 去向: '线索', 原因: `只留线索：Jev 判目录清单的概率最高（${百分(目录)}）` };
  return 官方 >= 转载 ? { 去向: '读详情', 原因: `Jev：${明细}，读详情` } : { 去向: '追溯', 原因: `Jev：${明细}，追溯上级比赛` };
}

function 检查(answer) {
  const 概率 = answer?.probabilities;
  if (!概率 || typeof 概率 !== 'object' || !Object.keys(概率).length) return '返回里没有各类别的概率';
  const 不对 = Object.entries(概率).filter(([k, v]) => !类别们.includes(k) || typeof v !== 'number' || v < 0 || v > 1);
  return 不对.length ? `概率不对：${不对.map(([k, v]) => `${k}=${v}`).join('、')}` : null;
}

export async function Jev筛选(候选们, ctx) {
  if (!候选们.length) return [];
  const 剩 = ctx.ai.budgetLeft?.() ?? Infinity;
  if (候选们.length > 剩) throw new Error(`Jev 筛选额度不够：要 ${候选们.length} 次，只剩 ${剩} 次`);
  const pool = createPool({ limit: 并发, signal: ctx.signal });
  const 回来 = await pool.map(候选们, c => ctx.ai.decide({
    purpose: 用途,
    state: { title: String(c.data.name || '').slice(0, 300), snippet: String(c.data.snippet || '').slice(0, 1600), url: String(c.data.url || c.key).slice(0, 600), source: (c.data.渠道们 || []).join('、').slice(0, 120) },
    questions: 题目(),
    signal: ctx.signal,
  }));
  const 出错 = 回来.find(r => !r.ok);
  if (出错) throw 出错.error;
  return 回来.map((r, i) => {
    const answer = r.value?.answers?.kind;
    const 问题 = 检查(answer);
    if (问题) {
      ctx.ai.报告问题({ purpose: 用途, promptVersion: 版本, 原因: `${候选们[i].key}：${问题}` });
      throw new Error(`Jev 筛选返回的内容用不了：${问题}`);
    }
    return { key: 候选们[i].key, ...按概率分(answer.probabilities), 类别: answer.choice, 概率: answer.probabilities };
  });
}
