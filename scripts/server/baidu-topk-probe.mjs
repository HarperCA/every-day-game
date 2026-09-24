// 一次性诊断：百度 AI 搜索网页结果为何每次只回 10 条（文档写上限 50、默认 20）。
// 同一查询，三种请求各调 1 次，共 3 次额度。结果写 reports/baidu-topk-probe-<日期>.json
import fs from 'node:fs';
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');
const key = fs.readFileSync('/opt/daily-contest/.baidu-search-key', 'utf8').trim();
const query = '2026 大学生 数学建模 竞赛 报名';
const variants = {
  default: {},
  top_k20: { resource_type_filter: [{ type: 'web', top_k: 20 }] },
  top_k50: { resource_type_filter: [{ type: 'web', top_k: 50 }] },
};
const out = { at: new Date().toISOString(), query, results: {} };
for (const [label, extra] of Object.entries(variants)) {
  try {
    const r = await fetch('https://qianfan.baidubce.com/v2/ai_search/web_search', {
      method: 'POST',
      headers: { 'X-Appbuilder-Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ content: query, role: 'user' }], search_source: 'baidu_search_v2', ...extra }),
      signal: AbortSignal.timeout(30000),
    });
    const j = await r.json();
    const refs = j.references || [];
    out.results[label] = { status: r.status, count: refs.length, types: [...new Set(refs.map(x => x.type))], keys: Object.keys(j), code: j.code || null, message: j.message || null, urls: refs.map(x => x.url) };
  } catch (e) { out.results[label] = { error: e.cause?.code || e.message }; }
  await new Promise(res => setTimeout(res, 1000));
}
fs.writeFileSync(`/opt/daily-contest/reports/baidu-topk-probe-${out.at.slice(0, 10)}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(Object.fromEntries(Object.entries(out.results).map(([k, v]) => [k, v.count ?? v.error ?? v.code]))));
