// 搬旧数据 · 写进库并核对（2026-11-02）。只往空库里搬，不和已有的数据混在一起；副数据库一个事务写完，任何一条出错整个撤回。
// 写完逐表核对条数、逐条核对编号都在。报告里只有表名、编号、原因和条数，不带 openid 和用户写的内容。
//   搬(旧, { 用户库, 报错库, 届次对照 }) → { 写了: { 表: 条数 }, 问题们, 核对通过, 核对问题们 }
import { 转换, 表们 } from './转换.mjs';
import { TABLES } from '../副数据库/index.mjs';

function 报错条数(报错库) {
  let 数 = 0;
  for (let 批 = 报错库.之后(0, 5000); 批.length; 批 = 报错库.之后(批.at(-1).id, 5000)) 数 += 批.length;
  return 数;
}

export function 搬(旧, { 用户库, 报错库, 届次对照 }) {
  const 已有 = 表们.filter(表 => 用户库.count(表) > 0);
  if (已有.length || 报错条数(报错库) || 报错库.全部统计().length) throw new Error(`目标库不是空的（${已有.join('、') || '报错库'} 已有数据），不搬，免得和已有的混在一起`);
  const { 新, 报错, 问题们 } = 转换(旧, { 届次对照 });

  用户库.transaction(tx => {
    for (const 表 of 表们) for (const 行 of 新[表]) tx.insert(表, 行[TABLES[表].主键], 行);
  });
  报错库.收下(报错.issues);
  for (const s of 报错.stats) 报错库.写统计(s.date, s.list, s.get);

  const 写了 = Object.fromEntries(表们.map(表 => [表, 用户库.count(表)]));
  写了.client_issues = 报错条数(报错库);
  写了.client_stats = 报错库.全部统计().length;
  const 核对问题们 = [];
  for (const 表 of 表们) {
    if (写了[表] !== 新[表].length) 核对问题们.push(`${表}：要写 ${新[表].length} 条，库里 ${写了[表]} 条`);
    for (const 行 of 新[表]) if (!用户库.get(表, 行[TABLES[表].主键])) 核对问题们.push(`${表} 少了 ${行[TABLES[表].主键]}`);
  }
  if (写了.client_issues !== 报错.issues.length) 核对问题们.push(`client_issues：要写 ${报错.issues.length} 条，库里 ${写了.client_issues} 条`);
  if (写了.client_stats !== 报错.stats.length) 核对问题们.push(`client_stats：要写 ${报错.stats.length} 条，库里 ${写了.client_stats} 条`);
  return { 写了, 问题们, 核对通过: 核对问题们.length === 0, 核对问题们 };
}
