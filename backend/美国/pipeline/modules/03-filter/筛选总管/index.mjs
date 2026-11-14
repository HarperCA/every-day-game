// 筛选总管：03 筛选的主流程。按顺序调用下面三个，每个给出“去向”，总管照去向经小数据库的工具维护当晚的条目。
//
//   标题筛选/       标题筛选(候选)               程序化筛选，只看标题
//   Jev筛选/        Jev筛选(候选们, ctx)         标题看不出来的交 Jev 判是哪类页面
//   Codex代理追踪/  Codex代理追踪(通知们, ctx)   要追溯的交 Codex 追到比赛自己的官方来源
//
// 去向：
//   扔      ctx.小数据库.删除（标已丢弃并写原因），顺带在改动里记“拒过的网址”，30 天内 02 对比去重遇到就扔
//   线索    ctx.小数据库.标记线索（只留作线索，不往下走）
//   读详情  仍是进行中，data.筛选 写明去向和原因，交给 04 读详情和抽取
//   追溯    交 Codex 代理追踪：找到官方来源的，官方来源作为新候选往下走、通知标已丢弃；不是比赛的扔；
//           只是赛区、找不到、读不出的标线索；额度用完的标顺延
// 删除、标记线索的原因前面写明“03 筛选·哪一步”（标题筛选、Jev筛选、Codex代理追踪）。
// 另外两条（搬自旧 run-crawl-pipeline.mjs）：平台登记的比赛条目不用筛，直接读详情；判成读详情或线索、但网站读不了或标题是通知的，改去追溯。
import { 标题筛选 } from '../标题筛选/index.mjs';
import { Jev筛选 } from '../Jev筛选/index.mjs';
import { Codex代理追踪 } from '../Codex代理追踪/index.mjs';
import { 比赛身份, 搜索候选键 } from '../../../common/届次与赛道.mjs';
import { 拒过改动 } from '../../../common/拒过.mjs';
import { 读不了 } from './读不了的网站.mjs';

export const meta = { title: '筛选', version: 2 };
export const DEFAULT_PARTS = { 标题筛选, Jev筛选, Codex代理追踪 };
export const 模块名 = '03-filter';

const 是平台条目 = c => (c.data.路线们 || []).includes('平台');
const 标题是通知 = c => /通知|公告|通告/.test(String(c.data.name || ''));

export function createRun(parts = DEFAULT_PARTS) {
  return async function run(input, ctx) {
    const 候选们 = ctx.小数据库.查找({ kind: 'candidate' });
    if (!候选们.length) {
      ctx.log.info('筛选：今晚没有候选');
      return { items: [], changes: [], problems: [] };
    }

    // 1. 平台条目和标题筛选
    const 去向 = new Map();
    const 问Jev = [];
    for (const c of 候选们) {
      if (是平台条目(c)) { 去向.set(c.key, { 去向: '读详情', 类别: 'platform_entry', 原因: '平台登记的比赛条目，不用筛，直接读详情', 步: '平台条目' }); continue; }
      const r = parts.标题筛选(c);
      if (r) 去向.set(c.key, { ...r, 步: '标题筛选' }); else 问Jev.push(c);
    }
    // 2. Jev 筛选
    for (const r of await parts.Jev筛选(问Jev, ctx)) 去向.set(r.key, { 去向: r.去向, 类别: r.类别, 原因: r.原因, 步: 'Jev筛选' });
    // 3. 读不了的网站、标题是通知的，改去追溯
    for (const c of 候选们) {
      const d = 去向.get(c.key);
      if (是平台条目(c) || !['读详情', '线索'].includes(d.去向)) continue;
      if (d.去向 === '读详情' && 读不了(c.data.url || c.key)) 去向.set(c.key, { ...d, 去向: '追溯', 原因: `${d.原因}；但这个网站读不了，改去追溯` });
      else if (标题是通知(c)) 去向.set(c.key, { ...d, 去向: '追溯', 原因: `${d.原因}；标题是通知，只用来追溯` });
    }

    const 一组 = name => 候选们.filter(c => 去向.get(c.key).去向 === name);
    const 删 = [];
    const 线索 = [];
    const items = [];
    const changes = [];
    const 写明 = (步, 原因) => `03 筛选·${步}：${原因}`;
    const 扔掉 = (c, 原因) => {
      删.push({ key: c.key, 原因 });
      const change = 拒过改动({ item: c, 原因, module: 模块名, runId: input.runId, now: ctx.now() });
      if (change) changes.push(change);
    };
    for (const c of 一组('扔')) 扔掉(c, 写明(去向.get(c.key).步, 去向.get(c.key).原因));
    for (const c of 一组('线索')) 线索.push({ key: c.key, 原因: 写明(去向.get(c.key).步, 去向.get(c.key).原因) });
    for (const c of 一组('读详情')) {
      const d = 去向.get(c.key);
      items.push({ key: c.key, kind: c.kind, status: '进行中', data: { ...c.data, 筛选: d }, result: '读详情', reason: d.原因 });
    }

    // 4. Codex 代理追踪
    const 通知们 = 一组('追溯').map(c => ({ ...c, data: { ...c.data, 筛选: 去向.get(c.key) } }));
    const 新候选 = new Set();
    for (const r of await parts.Codex代理追踪(通知们, ctx)) {
      const 通知 = 通知们.find(c => c.key === r.key);
      if (r.顺延) { items.push({ key: 通知.key, kind: 通知.kind, status: '顺延', data: 通知.data, result: '顺延', reason: r.原因 }); continue; }
      if (r.结果 === '不是比赛') { 扔掉(通知, 写明('Codex代理追踪', `不是比赛：${r.原因}`)); continue; }
      if (r.结果 !== '找到官方来源') { 线索.push({ key: 通知.key, 原因: 写明('Codex代理追踪', `${r.结果}：${r.原因}`) }); continue; }
      const 来源 = r.官方来源[0];
      删.push({ key: 通知.key, 原因: 写明('Codex代理追踪', `已追溯到官方来源 ${来源.网址}，官方来源作为新候选往下走`) });
      const 名称 = r.比赛名 || 通知.data.name;
      const 赛道 = 比赛身份(通知.data.name, 通知.data.track_name).赛道 || 比赛身份(名称).赛道;
      const key = 搜索候选键(来源.网址, 名称, 赛道);
      if (新候选.has(key) || ctx.item(key)) continue;   // 今晚已经是候选了，不重复加
      新候选.add(key);
      items.push({ key, kind: 'candidate', status: '进行中', result: '追溯到的官方来源', reason: `由 ${通知.key} 追溯而来：${r.原因}`,
        data: { name: 名称, ...(赛道 && { track_name: 赛道 }), url: 来源.网址, snippet: 来源.摘录, 渠道们: ['Codex 代理追踪'], 追溯自: 通知.key,
          追溯: { 结果: r.结果, 理由: r.原因, 官方来源: r.官方来源 }, 筛选: { 去向: '读详情', 类别: 'traced_official', 原因: 'Codex 代理追踪追到的官方来源' } } });
    }

    if (删.length) ctx.小数据库.删除(删);
    if (线索.length) ctx.小数据库.标记线索(线索);
    ctx.log.info(`筛选：候选 ${候选们.length} 条，问 Jev ${问Jev.length} 条，追溯 ${通知们.length} 条；读详情 ${items.filter(i => i.status === '进行中').length} 条（含追到的官方来源 ${新候选.size} 条），扔 ${删.length} 条（含追溯完的通知），线索 ${线索.length} 条`);
    return { items, changes, problems: [] };
  };
}

export const run = createRun();
