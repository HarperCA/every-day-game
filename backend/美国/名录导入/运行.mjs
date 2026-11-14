// 名录导入 · 命令行。默认只试跑（不写库）：报告写到 --报告 指定的文件。
//   node 运行.mjs --全量 全量比赛资料表.csv --核查 可以入库-全量核查结果.csv --报告 报告.json [--库 比赛库.db] [--写入 是]
//   node 运行.mjs --撤回 是 [--库 比赛库.db] [--批次 名录导入-20261106]
//   node 运行.mjs --补充 是 --全量 11-04补查版全量比赛资料表.csv --核查 可以入库-全量核查结果.csv --报告 报告.json [--库 比赛库.db] [--写入 是]     11-04 补查版剩下的，批次 名录导入-20261106
//   node 运行.mjs --转归档 是 --报告 报告.json [--库 比赛库.db] [--写入 是]     比赛结束日已过的历史届转已归档，转了就公开
//   node 运行.mjs --海报 计划.json --图片 图片目录 [--库 比赛库.db] [--海报目录 目录] [--写入 是]   见 海报.mjs
// 不给 --库 时用 DB_DIR/比赛库.db。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../db/index.mjs';
import { 排计划, 排补充计划, 写入, 撤回, 解析CSV, 转归档 } from './index.mjs';
import { 写海报 } from './海报.mjs';

export const 批次 = '名录导入-20261104';
export const 补充批次 = '名录导入-20261106';

function 参数(argv) {
  const 结果 = {};
  for (let i = 0; i < argv.length; i += 1) if (argv[i].startsWith('--')) 结果[argv[i].slice(2)] = argv[i + 1];
  return 结果;
}

function 补充({ db, 全量, 核查, 报告, 要写, at }) {
  const 现有届次们 = db.find('edition', {}, { 包括已删除: true });
  const 计划 = 排补充计划({ 行们: 解析CSV(fs.readFileSync(全量, 'utf8')), 核查们: 解析CSV(fs.readFileSync(核查, 'utf8')),
    已导入行号: 现有届次们.filter(e => e.created_by === 批次).map(e => e.legacy?.名录导入?.源行号),
    现有比赛们: db.find('competition', {}, { 包括已删除: true }), 现有届次们, 不再收录们: db.find('blocked_competition', {}), 批次: 补充批次, at });
  const 原因统计 = {};
  for (const { 原因 } of 计划.跳过) {
    const 类 = 原因.replace(/^库里已有这一年.*/, '库里已有这一年').replace(/^关联库内.*/, '关联库内赛事').replace(/^比赛在回收站.*/, '比赛在回收站');
    原因统计[类] = (原因统计[类] || 0) + 1;
  }
  const 挂已有 = 计划.届次们.filter(e => !计划.比赛们.some(c => c.id === e.data.competition_id));
  const 摘要 = { 比赛: 计划.比赛们.length, 届次: 计划.届次们.length, 挂到已有比赛: 挂已有.length, 来源: 计划.来源们.length, 跳过: 计划.跳过.length, 原因统计,
    报名未截止: 计划.届次们.filter(e => String(e.data.registration_end || '').slice(0, 10) >= at.slice(0, 10)).map(e => ({ 编号: e.id, 名称: e.data.edition_name, 截止: e.data.registration_end })) };
  if (报告) fs.writeFileSync(报告, JSON.stringify({ ...摘要, 挂已有明细: 挂已有.map(e => ({ 编号: e.id, 名称: e.data.edition_name, 比赛: e.data.competition_id, 顺序: e.data.ordinal })), 跳过明细: 计划.跳过 }, null, 1), 'utf8');
  return 要写 ? { ...摘要, 写入: 写入(db, 计划, { 批次: 补充批次, at }) } : { ...摘要, 试跑: true };
}

export function 运行({ 全量, 核查, 报告, 库, 写入: 要写, 撤回: 要撤, 转归档: 要归档, 海报: 海报计划, 图片: 图片目录, 海报目录, 补充: 要补充, 批次: 撤回批次 }, at = new Date().toISOString()) {
  const db = openDb(库 ? { file: 库 } : {});
  try {
    if (要撤) return 撤回(db, { 批次: 撤回批次 || 批次, at });
    if (要补充) return 补充({ db, 全量, 核查, 报告, 要写, at });
    if (海报计划) {
      const 项们 = JSON.parse(fs.readFileSync(海报计划, 'utf8')).filter(p => ['海报', '候选'].includes(p.action));
      const 选项 = { 读文件: 名 => fs.readFileSync(path.join(图片目录, 名)), at, 试跑: !要写, ...(海报目录 ? { 目录: 海报目录 } : {}) };
      return { ...写海报(db, 项们, 选项), 试跑: !要写 };
    }
    if (要归档) {
      const 结果 = 转归档(db, { 批次, at, 试跑: !要写 });
      if (报告) fs.writeFileSync(报告, JSON.stringify({ at, ...结果 }, null, 1), 'utf8');
      return { 届次: 结果.编号们.length, 试跑: 结果.试跑 };
    }
    const 行们 = 解析CSV(fs.readFileSync(全量, 'utf8'));
    const 核查们 = 解析CSV(fs.readFileSync(核查, 'utf8'));
    // 回收站里的和后台勾了“不再收录”的也算库里已有，不导回来
    const 现有比赛们 = [...db.find('competition', {}, { 包括已删除: true }), ...db.find('blocked_competition', {})];
    const 计划 = 排计划({ 行们, 核查们, 现有比赛们, 批次, at });
    const 原因统计 = {};
    for (const { 原因 } of 计划.跳过) {
      const 类 = 原因.replace(/^库里已有.*/, '库里已有').replace(/^和第 \d+ 行.*/, '同名同年').replace(/^关联库内.*/, '关联库内赛事');
      原因统计[类] = (原因统计[类] || 0) + 1;
    }
    const 摘要 = {
      总行数: 行们.length, 比赛: 计划.比赛们.length, 届次: 计划.届次们.length, 来源: 计划.来源们.length, 跳过: 计划.跳过.length, 原因统计,
      报名未截止: 计划.届次们.filter(e => String(e.data.registration_end || '').slice(0, 10) >= at.slice(0, 10)).map(e => ({ 编号: e.id, 名称: e.data.edition_name, 截止: e.data.registration_end })),
    };
    if (报告) fs.writeFileSync(报告, JSON.stringify({ ...摘要, 跳过明细: 计划.跳过 }, null, 1), 'utf8');
    return 要写 ? { ...摘要, 写入: 写入(db, 计划, { 批次, at }) } : { ...摘要, 试跑: true };
  } finally { db.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(运行(参数(process.argv.slice(2))), null, 1));
}
