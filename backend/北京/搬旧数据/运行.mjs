// 搬旧数据 · 命令行入口（2026-11-02）。上海导出只读，新库写到一个新目录，已有的库文件不碰。
//   node backend/北京/搬旧数据/运行.mjs --旧数据 <上海导出的文件夹> --届次对照 <届次对照.json> [--目录 <写到哪>]
//     不给 --目录 时写到 北京/搬旧数据/数据/试搬-<时间>/（不进 git）：用户管理中心.db、报错日志.db、报告.md
//     正式切换时把 --目录 指到北京服务器的 DB_DIR（要求里面还没有这两个库，或是空的）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openUserDb } from '../副数据库/index.mjs';
import { 打开报错库 } from '../服务/收集报错/报错库.mjs';
import { 搬 } from './搬.mjs';
import { 表们 } from './转换.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const 集合们 = [...表们, 'client_issues', 'client_stats'];

export function 读导出(文件夹) {
  const 旧 = {};
  for (const 名 of 集合们) {
    const 文件 = path.join(文件夹, `${名}.json`);
    旧[名] = fs.existsSync(文件) ? JSON.parse(fs.readFileSync(文件, 'utf8')) : [];
    if (!Array.isArray(旧[名])) throw new Error(`${名}.json 不是列表`);
  }
  return 旧;
}

export function 写报告({ 写了, 问题们, 核对通过, 核对问题们 }, 旧, { 来源 }) {
  const 按原因 = {};
  for (const 问 of 问题们) {
    const 键 = `${问.表}｜${问.原因.replace(/(届次|账号) \S+ /, '$1 … ')}`;
    (按原因[键] ||= []).push(问.编号);
  }
  return [
    `# 搬旧数据报告`, '', `- 来源：${来源}`, `- 时间：${new Date().toISOString()}`, `- 核对：${核对通过 ? '通过' : '没通过'}`, '',
    '| 集合 | 上海导出 | 写进北京 |', '|---|---:|---:|',
    ...集合们.map(名 => `| ${名} | ${旧[名].length} | ${写了[名]} |`), '',
    核对问题们.length ? ['## 核对问题', ...核对问题们.map(x => `- ${x}`), ''].join('\n') : '',
    '## 没搬的（按原因）', '',
    ...Object.entries(按原因).map(([键, 编号们]) => `- ${键}：${编号们.length} 条（${编号们.slice(0, 10).join('、')}${编号们.length > 10 ? '…' : ''}）`),
    Object.keys(按原因).length ? '' : '- 没有',
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const 参数 = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  const 文件夹 = 参数('--旧数据'); const 对照文件 = 参数('--届次对照');
  if (!文件夹 || !对照文件) { console.error('要给 --旧数据 <上海导出的文件夹> 和 --届次对照 <文件.json>'); process.exit(1); }
  const 目录 = 参数('--目录') || path.join(HERE, '数据', `试搬-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(目录, { recursive: true });
  const 旧 = 读导出(文件夹);
  const 用户库 = openUserDb({ file: path.join(目录, '用户管理中心.db') });
  const 报错库 = 打开报错库(path.join(目录, '报错日志.db'));
  try {
    const 报告 = 搬(旧, { 用户库, 报错库, 届次对照: JSON.parse(fs.readFileSync(对照文件, 'utf8')) });
    fs.writeFileSync(path.join(目录, '报告.md'), 写报告(报告, 旧, { 来源: 文件夹 }), 'utf8');
    console.log(`写了 ${JSON.stringify(报告.写了)}；没搬 ${报告.问题们.length} 条；核对${报告.核对通过 ? '通过' : '没通过'}。报告：${path.join(目录, '报告.md')}`);
    if (!报告.核对通过) process.exitCode = 1;
  } finally {
    用户库.close(); 报错库.关闭();
  }
}
