// 读库：对比去重要用的库里数据，全部经这一个统一的查询读齐（只读 ctx.list，不直接碰比赛库）。
//
//   读库(ctx) → {
//     比赛们:  [{ 编号, 名称, 别名们, 级别, 地区 }]      不含已删除的；给程序去重比名称、给 AI 去重当名单
//              全部届次都在待人工审核的比赛不算“库里已有”，名称和网址都不进来（2026-11-04 用户定）：
//              它们学生还看不到，新通知得能往下走；06 入库时会按名称对上，挂到这个比赛下。
//     网址们:  Map(网址键 → 说明)                       比赛官网、届次报名入口和线索通知、来源网址（含跳转后的）
//     不收录:  [{ 名称们, 网址键, 原因 }]                后台勾了“以后不再收录”的
//     拒过:    Map(网址键 → { 原因, 模块 })              30 天内寻找流程拒过的
//     比赛名:  编号 → 名称
//   }
import { 网址键 } from '../../../common/网址键.mjs';

export const 拒过保留天数 = 30; // 和 db/操作/拒过的网址.mjs 的保留天数一致（到期后每日清理会删掉）

const 活着 = rows => rows.filter(row => !row.data?.deleted_at);

export function 读库(ctx) {
  const 活着的届次 = 活着(ctx.list('edition'));
  const 有过审届次的 = new Set(活着的届次.filter(row => row.data.status !== '待人工审核').map(row => row.data.competition_id));
  const 有届次的 = new Set(活着的届次.map(row => row.data.competition_id));
  const 比赛行 = 活着(ctx.list('competition')).filter(row => !有届次的.has(row.key) || 有过审届次的.has(row.key));
  const 比赛编号们 = new Set(比赛行.map(row => row.key));
  const 届次行 = 活着的届次.filter(row => 比赛编号们.has(row.data.competition_id));
  const 届次编号们 = new Set(届次行.map(row => row.key));

  const 网址们 = new Map();
  const 记 = (url, 说明) => { const key = 网址键(url); if (key && !网址们.has(key)) 网址们.set(key, 说明); };
  for (const { key, data } of 比赛行) 记(data.website, `库里比赛 ${key} 的官网`);
  for (const { key, data } of 届次行) {
    记(data.registration_url, `库里届次 ${key} 的报名入口`);
    记(data.discovery_notice_url, `库里届次 ${key} 的线索通知`);
  }
  for (const { data } of ctx.list('source').filter(row => 届次编号们.has(row.data.edition_id))) {
    记(data.url, `库里届次 ${data.edition_id} 的来源`);
    记(data.final_url, `库里届次 ${data.edition_id} 的来源`);
  }

  const 界线 = ctx.now().getTime() - 拒过保留天数 * 86400000;
  const 拒过 = new Map();
  for (const { data } of ctx.list('rejected_url')) {
    if (Date.parse(data.rejected_at) >= 界线 && !拒过.has(data.url_key)) 拒过.set(data.url_key, { 原因: data.reason, 模块: data.module });
  }

  const 比赛们 = 比赛行.map(({ key, data }) => ({ 编号: key, 名称: data.name, 别名们: data.aliases || [], 级别: data.level || '', 地区: data.region || '' }));
  const 名称表 = new Map(比赛们.map(c => [c.编号, c.名称]));
  return {
    比赛们,
    网址们,
    不收录: ctx.list('blocked_competition').map(({ data }) => ({ 名称们: [data.name, ...(data.aliases || [])], 网址键: 网址键(data.website), 原因: data.reason || '' })),
    拒过,
    比赛名: 编号 => 名称表.get(编号),
  };
}
