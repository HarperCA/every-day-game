// Codex 代理追踪：要追溯的候选（学校转发、校内选拔、赛事报道、读不了的页面、标题是通知的），交给 Codex 一条条追到比赛自己的官方来源。
// Codex 只做决定（经 AI 总管，用途 trace），每一轮回一个动作：搜索、读网页或给结论；程序替它执行，把结果交回下一轮。
//   搜索    ctx.ai.search（百度 → Kimi → DeepSeek 补位）
//   读网页  ctx.web.读网页（美国/web，自己的程序读，不交给 Kimi，2026-11-01 用户定）；交给 Codex 前用这里的 网页给Codex() 截短、列出链接
// 结论里的官方来源由程序核对：必须是这一条里读过、读到正文的网址，摘录要在原文里；一个不剩就改成“找不到官方来源”。
//
//   Codex代理追踪(通知们, ctx, { 并发, 最多轮数 }) → [{ key, 结果, 原因, 比赛名, 官方来源: [{ 网址, 摘录 }] } | { key, 顺延: true, 原因 }]
//
// 出错就抛错，截断流程（和 02 对比去重一样）；只有“额度用完”不截断：这一条和还没轮上的标顺延，下一晚接着追。
// 网页读不到不算出错，告诉 Codex 读不到，让它换办法。
// 改编自旧的 scripts/server/notice-agent.mjs（提示词、五种结论、来源核对的规则）。
import { createPool } from '../../../../../共用/工具/concurrency.mjs';
import { loadPrompt } from '../../../common/prompt.mjs';
import { 检查动作 } from './schema.mjs';

export const 用途 = 'trace';
export const 最多轮数 = 6;
export const 提示词文件 = new URL('./prompt.md', import.meta.url);
const 每页最多字 = 6000;
const 正文最少字 = 200;

class 顺延 extends Error {}
const 是额度用完 = error => error?.kind === '额度用完';
// 比较摘录和原文时去掉空白和标点
const 压 = text => String(text || '').replace(/[\s\p{P}\p{S}]/gu, '');

function 核对来源(结论, 读过) {
  if (结论.结果 !== '找到官方来源') return { 结果: 结论.结果, 原因: 结论.理由, 官方来源: [] };
  const 留 = [];
  const 去掉 = [];
  for (const s of 结论.官方来源) {
    const 正文 = 读过.get(s.网址);
    const why = 正文 === undefined ? '没读过' : 正文.length < 正文最少字 ? '没读到正文' : !压(s.摘录) || !压(正文).includes(压(s.摘录)) ? '摘录不在原文里' : '';
    if (why) 去掉.push(`${s.网址}：${why}`); else 留.push({ 网址: s.网址, 摘录: s.摘录 });
  }
  if (!留.length) return { 结果: '找不到官方来源', 原因: `官方来源没核对上（${去掉.join('；')}）；Codex 原结论：${结论.理由}`, 官方来源: [] };
  return { 结果: '找到官方来源', 原因: 结论.理由, 官方来源: 留 };
}

async function 追一条(通知, ctx, { 轮数, 版本, 系统 }) {
  const messages = [
    { role: 'system', content: 系统 },
    { role: 'user', content: `标题：${通知.data.name || ''}\n网址：${通知.data.url || 通知.key}\n摘要：${String(通知.data.snippet || '').slice(0, 700)}\n筛选时的判断：${通知.data.筛选?.原因 || ''}` },
  ];
  const 读过 = new Map();
  for (let 轮 = 1; 轮 <= 轮数; 轮++) {
    if (轮 === 轮数) messages.push({ role: 'user', content: '这是最后一轮，必须给出结论。' });
    let data;
    try {
      ({ data } = await ctx.ai.chat({ purpose: 用途, messages, json: true, promptVersion: 版本, signal: ctx.signal }));
    } catch (error) {
      if (是额度用完(error)) throw new 顺延(error.message);
      throw error;
    }
    const 问题 = 检查动作(data);
    if (问题) {
      ctx.ai.报告问题({ purpose: 用途, promptVersion: 版本, 原因: `${通知.key}：${问题}` });
      throw new Error(`Codex 代理追踪交回的内容用不了：${问题}`);
    }
    if (data.动作 === '结论') return { key: 通知.key, 比赛名: data.结论.比赛名 || '', ...核对来源(data.结论, 读过) };
    messages.push({ role: 'assistant', content: JSON.stringify(data) });
    messages.push({ role: 'user', content: await 执行(data, ctx, 读过) });
  }
  ctx.ai.报告问题({ purpose: 用途, promptVersion: 版本, 原因: `${通知.key}：${轮数} 轮都没给出结论` });
  throw new Error(`Codex 代理追踪交回的内容用不了：${轮数} 轮都没给出结论`);
}

async function 执行(动作, ctx, 读过) {
  if (动作.动作 === '搜索') {
    let r;
    try {
      r = await ctx.ai.search({ purpose: 'search', query: 动作.搜索词, site: 动作.网站 || '', blocked: ctx.屏蔽网站?.() || [], signal: ctx.signal });
    } catch (error) {
      if (是额度用完(error)) throw new 顺延(error.message);
      throw error;
    }
    const 行 = (r.references || []).slice(0, 8).map((x, i) => `${i + 1}. ${x.title || ''}｜${x.url || ''}｜${String(x.content || '').replace(/\s+/g, ' ').slice(0, 200)}`);
    return `搜索“${动作.搜索词}”的结果：\n${行.join('\n') || '（没有结果）'}`;
  }
  const 页 = await ctx.web.读网页(动作.网址, { signal: ctx.signal });
  if (!['成功', '正文太短'].includes(页.status)) return `没读到 ${动作.网址}：${页.status}，${页.error}。换个办法。`;
  读过.set(动作.网址, 页.text);
  if (页.finalUrl && 页.finalUrl !== 动作.网址) 读过.set(页.finalUrl, 页.text);
  return 网页给Codex(动作.网址, 页);
}

// 交给 Codex 的网页：正文截到 6000 字，后面列出页面里的链接（最多 15 个），让它选下一步读哪个
export function 网页给Codex(网址, 页) {
  const 正文 = String(页.text || '');
  const 链接 = (页.links || []).slice(0, 15).map(l => `- [${l.kind}] ${l.text}｜${l.url}`);
  return [`读 ${网址} 的结果（${页.status === '正文太短' ? '正文很短，可能是脚本加载的空壳页；' : ''}共 ${正文.length} 字${正文.length > 每页最多字 ? `，只给前 ${每页最多字} 字` : ''}）：`,
    正文.slice(0, 每页最多字), 链接.length ? `页面里的链接：\n${链接.join('\n')}` : '页面里没有找到链接。'].join('\n');
}

export async function Codex代理追踪(通知们, ctx, { 并发 = 2, 轮数 = 最多轮数 } = {}) {
  if (!通知们.length) return [];
  const { version: 版本, text: 系统 } = loadPrompt(提示词文件, { 今天: new Date(ctx.now().getTime() + 8 * 3600000).toISOString().slice(0, 10), 最多轮数: 轮数 });
  let 停下 = null;   // 额度用完以后，还没开始的都顺延，不再调
  const pool = createPool({ limit: 并发, signal: ctx.signal });
  const 回来 = await pool.map(通知们, async 通知 => {
    if (停下) throw new 顺延(停下);
    try {
      return await 追一条(通知, ctx, { 轮数, 版本, 系统 });
    } catch (error) {
      if (error instanceof 顺延) 停下 ||= error.message;
      throw error;
    }
  });
  const 出错 = 回来.find(r => !r.ok && !(r.error instanceof 顺延));
  if (出错) throw 出错.error;
  return 回来.map((r, i) => (r.ok ? r.value : { key: 通知们[i].key, 顺延: true, 原因: `额度用完，下一晚接着追：${r.error.message}` }));
}
