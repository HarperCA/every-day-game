// 结果处理（纯计算）：合并搜索接口和平台的结果。网址规范化（去掉跟踪参数）后同一网址按赛道合成候选，
// 记下所有渠道、搜索词、路线（07 统计各路线产出用）；网址不对的去掉并记问题。和库里对比去重不在这里，在 02-dedup。
//
//   处理结果({ 结果们, 问题们 }) → { 候选们: [{ key: 规范化网址, data: { name, url, snippet, 渠道们, 搜索词们, 路线们 } }], 问题们 }
import { 搜索候选键, 比赛身份, 比届次 } from '../../../common/届次与赛道.mjs';
import { normalizeUrl } from '../../../../web/index.mjs';

const 加 = (列表, 值) => { if (值 && !列表.includes(值)) 列表.push(值); };

export function 处理结果({ 结果们 = [], 问题们 = [] }) {
  const 按候选 = new Map();
  let 网址不对 = 0;
  for (const r of 结果们) {
    let url;
    try { url = normalizeUrl(r.网址); } catch { 网址不对 += 1; continue; }
    const key = 搜索候选键(url, r.标题);
    if (!按候选.has(key)) 按候选.set(key, { name: r.标题 || '', url, snippet: r.摘要 || '', 渠道们: [], 搜索词们: [], 路线们: [] });
    const c = 按候选.get(key);
    const 新 = 比赛身份(r.标题);
    const 旧 = 比赛身份(c.name);
    if (新.名称键 === 旧.名称键 && 比届次(新, 旧) === 1) {
      c.name = r.标题;
      c.snippet = r.摘要 || '';
    }
    加(c.渠道们, r.渠道); 加(c.搜索词们, r.搜索词); 加(c.路线们, r.路线);
  }
  return {
    候选们: [...按候选].map(([key, data]) => ({ key, data })),
    问题们: 网址不对 ? [...问题们, `${网址不对} 条结果的网址不对，去掉了`] : [...问题们],
  };
}
