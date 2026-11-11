// 补差量 · 命令行（2026-11-05）。默认只试跑。见 README.md。
//   node 运行补差量.mjs --基线 <上次搬用的文件夹> --现在 <新导出的文件夹> --届次对照 <文件.json> --报告 <报告.json>
//     [--目录 <库所在目录，默认 DB_DIR>] [--写入 是] [--不发名单 <文件.json>]
// 写入时：报告文件已存在就不跑（统计是按增量加的，同一份基线不能补两次）；不发名单写上海还管着的提醒编号，给 REMINDER_SKIP_FILE 用。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openUserDb } from '../副数据库/index.mjs';
import { 打开报错库 } from '../服务/收集报错/报错库.mjs';
import { 读导出 } from './运行.mjs';
import { 补差量 } from './补差量.mjs';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const 参数 = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  const [基线目录, 现在目录, 对照文件, 报告文件] = ['--基线', '--现在', '--届次对照', '--报告'].map(参数);
  if (!基线目录 || !现在目录 || !对照文件 || !报告文件) { console.error('要给 --基线 --现在 --届次对照 --报告'); process.exit(1); }
  const 要写 = 参数('--写入') === '是';
  if (要写 && fs.existsSync(报告文件)) { console.error(`报告 ${报告文件} 已存在：这份基线可能补过了，不重复补`); process.exit(1); }
  const 目录 = 参数('--目录') || process.env.DB_DIR;
  if (!目录) { console.error('要给 --目录 或设 DB_DIR'); process.exit(1); }
  const 用户库 = openUserDb({ file: path.join(目录, '用户管理中心.db') });
  const 报错库 = 打开报错库(path.join(目录, '报错日志.db'));
  try {
    const 结果 = 补差量(读导出(基线目录), 读导出(现在目录), { 用户库, 报错库, 届次对照: JSON.parse(fs.readFileSync(对照文件, 'utf8')), 试跑: !要写 });
    const { 上海提醒编号, ...报告 } = 结果;
    fs.writeFileSync(报告文件, JSON.stringify({ 时间: new Date().toISOString(), ...报告, 上海提醒数: 上海提醒编号.length }, null, 1), 'utf8');
    if (要写 && 参数('--不发名单')) fs.writeFileSync(参数('--不发名单'), JSON.stringify(上海提醒编号), 'utf8');
    console.log(JSON.stringify({ 试跑: !要写, 统计: 结果.统计, 冲突: 结果.冲突们.length, 没搬: 结果.问题们.length, 核对通过: 结果.核对通过, 上海提醒数: 上海提醒编号.length }));
    if (结果.核对通过 === false) process.exitCode = 1;
  } finally {
    用户库.close(); 报错库.关闭();
  }
}
