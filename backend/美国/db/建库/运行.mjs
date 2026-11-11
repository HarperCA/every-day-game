// 建库 · 命令行：读旧数据 → 排计划 → 写进一个新的比赛库 → 核对没丢东西 → 写报告。
//   node backend/美国/db/建库/运行.mjs --旧数据 <导出的 json> [--库 <新库文件>] [--报告 <报告文件>]
// 新库文件已经存在时拒绝写（不覆盖已有的库）；不给 --库 时写到 数据/建库试跑/比赛库-<时间>.db。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../index.mjs';
import { 写报告 } from './报告.mjs';
import { 排计划 } from './转换.mjs';
import { 搬比赛 } from './搬比赛.mjs';
import { 核对 } from './核对.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function 参数(argv) {
  const 结果 = {};
  for (let i = 0; i < argv.length; i += 1) if (argv[i].startsWith('--')) 结果[argv[i].slice(2)] = argv[i + 1];
  return 结果;
}

export function 运行({ 旧数据, 库, 报告 }) {
  if (!旧数据) throw new Error('要给 --旧数据 <从美国服务器导出的 json>');
  const 原始 = JSON.parse(fs.readFileSync(旧数据, 'utf8'));
  const 记录们 = Array.isArray(原始) ? 原始 : 原始.records;
  if (!Array.isArray(记录们)) throw new Error('旧数据里没有 records 数组');
  const 导出时间 = 原始.导出时间 || new Date().toISOString();
  const 时间戳 = 导出时间.replace(/[:.]/g, '-').slice(0, 19);
  const 库文件 = 库 || path.join(HERE, '..', '数据', '建库试跑', `比赛库-${时间戳}.db`);
  if (fs.existsSync(库文件)) throw new Error(`${库文件} 已经存在，不覆盖；换一个文件名或先移走`);

  const 计划 = 排计划(记录们, { 导出时间 });
  const db = openDb({ file: 库文件 });
  let 写入结果, 核对结果;
  try { 写入结果 = 搬比赛(计划, db); 核对结果 = 核对(记录们, db); } finally { db.close(); }

  const 报告文件 = 报告 || 库文件.replace(/\.db$/, '-报告.md');
  fs.writeFileSync(报告文件, 写报告({ 来源文件: path.basename(旧数据), 导出时间, 旧条数: 记录们.length, 计划, 写入结果, 核对结果 }), 'utf8');
  return { 库文件, 报告文件, 写入结果, 合并组: 计划.合并组们.length, 问题: 计划.问题们.length,
    核对: { 检查了: 核对结果.检查了, 对得上: 核对结果.对得上, 比赛级取代表那届: 核对结果.比赛级取代表那届, 找不到: 核对结果.找不到.length } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const 结果 = 运行(参数(process.argv.slice(2)));
  console.log(JSON.stringify(结果, null, 1));
}
