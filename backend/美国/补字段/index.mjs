// Codex 补字段（2026-11-03 用户定）：缺的字段交给 Codex 代理到官方网页上找，程序逐个核对，找得到原文出处的才填。
// 每晚流程的审核（新候选）和维护的缺失字段（库里已有的）共用这一个；两边按规矩互不引用，所以单独放在这里（和 ../程序审核/ 一样）。
// 做法照 pipeline/modules/03-filter/Codex代理追踪：Codex 每一轮只做决定（经 AI 总管，用途 fill），回一个动作——搜索、读网页或给结论；程序替它执行，把结果交回下一轮。
//   搜索    ctx.ai.search（百度 → Kimi → DeepSeek 补位，用途 search）
//   读网页  ctx.web.读网页（自己的程序读）；交给 Codex 前截短正文、列出链接
// 结论里的每个值由程序核对（核对.mjs）：网页读过、原文在网页里、值在原文里（日期是同一天、网址在网页里出现过、专业是十三类之一）。
//
//   补字段(记录, 要补的, ctx, { 轮数 }) → { 补到: { 字段: 值 }, 出处: { 字段: { 网址, 原文 } }, 待公布: [字段], 没补到: [字段], 来源们: [{ 网址, 原文 }], 原因 }
//     要补的：字段名列表（见 字段.mjs 的 字段表）；Codex 多给的字段不要
//     ctx：{ ai: { chat, search, 报告问题 }, web: { 读网页 }, now, signal, 屏蔽网站 }
// Codex 交回的格式不对、轮数用完没结论：报告给 AI 总管并抛错；额度用完（error.kind === '额度用完'）原样抛出，调用的地方决定顺延。
import { loadPrompt } from '../../共用/工具/提示词.mjs';
import { 字段表 } from './字段.mjs';
import { 核对一项, 核对待公布 } from './核对.mjs';
import { 检查动作 } from './schema.mjs';

export { 字段表, 专业分类 } from './字段.mjs';
export const 用途 = 'fill';
export const 最多轮数 = 8;
const 提示词文件 = new URL('./prompt.md', import.meta.url);
const 每页最多字 = 6000;

function 已知信息(记录) {
  const 行 = [];
  for (const [键, 名] of [['name', '比赛名称'], ['edition_name', '这一届'], ['organizer', '主办方'], ['website', '官网']]) if (记录[键]) 行.push(`${名}：${记录[键]}`);
  for (const s of (记录.sources || []).slice(0, 5)) if (s?.url) 行.push(`已知来源：${s.url}`);
  return 行.join('\n');
}

function 网页给Codex(网址, 页) {
  const 正文 = String(页.text || '');
  const 链接 = (页.links || []).slice(0, 15).map(l => `- [${l.kind}] ${l.text}｜${l.url}`);
  return [`读 ${网址} 的结果（${页.status === '正文太短' ? '正文很短，可能是脚本加载的空壳页；' : ''}共 ${正文.length} 字${正文.length > 每页最多字 ? `，只给前 ${每页最多字} 字` : ''}）：`,
    正文.slice(0, 每页最多字), 链接.length ? `页面里的链接：\n${链接.join('\n')}` : '页面里没有找到链接。'].join('\n');
}

async function 执行(动作, ctx, 读过) {
  if (动作.动作 === '搜索') {
    const r = await ctx.ai.search({ purpose: 'search', query: 动作.搜索词, site: 动作.网站 || '', blocked: ctx.屏蔽网站?.() || [], signal: ctx.signal });
    const 行 = (r.references || []).slice(0, 8).map((x, i) => `${i + 1}. ${x.title || ''}｜${x.url || ''}｜${String(x.content || '').replace(/\s+/g, ' ').slice(0, 200)}`);
    return `搜索“${动作.搜索词}”的结果：\n${行.join('\n') || '（没有结果）'}`;
  }
  const 页 = await ctx.web.读网页(动作.网址, { signal: ctx.signal });
  if (!['成功', '正文太短'].includes(页.status)) return `没读到 ${动作.网址}：${页.status}，${页.error || ''}。换个办法。`;
  const 记下 = { 正文: String(页.text || ''), 链接们: (页.links || []).map(l => l.url) };
  读过.set(动作.网址, 记下);
  if (页.finalUrl && 页.finalUrl !== 动作.网址) 读过.set(页.finalUrl, 记下);
  return 网页给Codex(动作.网址, 页);
}

function 核对结论(结论, 要补的, 读过) {
  const 要 = new Set(要补的);
  const 补到 = {}; const 出处 = {}; const 待公布 = []; const 问题 = [];
  for (const 项 of 结论.字段们) {
    if (!要.has(项.字段) || 项.字段 in 补到) continue;
    const r = 核对一项(项, 读过);
    if (r.ok) { 补到[项.字段] = r.值; 出处[项.字段] = { 网址: 项.网址, 原文: 项.原文 }; } else 问题.push(`${字段表[项.字段].名}：${r.原因}`);
  }
  for (const 项 of 结论.待公布 || []) {
    if (!要.has(项.字段) || 项.字段 in 补到 || 待公布.includes(项.字段)) continue;
    const r = 核对待公布(项, 读过);
    if (r.ok) { 待公布.push(项.字段); 出处[项.字段] = { 网址: 项.网址, 原文: 项.原文 }; } else 问题.push(`${字段表[项.字段]?.名 || 项.字段}（待公布）：${r.原因}`);
  }
  const 来源们 = [];
  for (const { 网址, 原文 } of Object.values(出处)) if (!来源们.some(s => s.网址 === 网址)) 来源们.push({ 网址, 原文 });
  const 没补到 = 要补的.filter(k => !(k in 补到) && !待公布.includes(k));
  return { 补到, 出处, 待公布, 没补到, 来源们, 原因: [结论.理由, ...问题].filter(Boolean).join('；') };
}

export async function 补字段(记录, 要补的, ctx, { 轮数 = 最多轮数 } = {}) {
  const 要 = 要补的.filter(k => 字段表[k]);
  if (!要.length) return { 补到: {}, 出处: {}, 待公布: [], 没补到: [], 来源们: [], 原因: '没有要补的' };
  const { version: 版本, text: 系统 } = loadPrompt(提示词文件, { 今天: new Date(ctx.now().getTime() + 8 * 3600000).toISOString().slice(0, 10), 最多轮数: 轮数 });
  const messages = [
    { role: 'system', content: 系统 },
    { role: 'user', content: `${已知信息(记录)}\n\n要补的字段：\n${要.map(k => `- ${字段表[k].名}（${k}）`).join('\n')}` },
  ];
  const 读过 = new Map();
  for (let 轮 = 1; 轮 <= 轮数; 轮++) {
    if (轮 === 轮数) messages.push({ role: 'user', content: '这是最后一轮，必须给出结论。' });
    const { data } = await ctx.ai.chat({ purpose: 用途, messages, json: true, promptVersion: 版本, signal: ctx.signal });
    const 问题 = 检查动作(data);
    if (问题) {
      ctx.ai.报告问题({ purpose: 用途, promptVersion: 版本, 原因: `${记录.name || ''}：${问题}` });
      throw new Error(`Codex 补字段交回的内容用不了：${问题}`);
    }
    if (data.动作 === '结论') return 核对结论(data.结论, 要, 读过);
    messages.push({ role: 'assistant', content: JSON.stringify(data) });
    messages.push({ role: 'user', content: await 执行(data, ctx, 读过) });
  }
  ctx.ai.报告问题({ purpose: 用途, promptVersion: 版本, 原因: `${记录.name || ''}：${轮数} 轮都没给出结论` });
  throw new Error(`Codex 补字段交回的内容用不了：${轮数} 轮都没给出结论`);
}
