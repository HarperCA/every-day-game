// 批量归档 · 命令行入口（手动跑，不挂定时器）。比赛库位置同 db/index.mjs（环境变量 DB_DIR，默认 db/数据/比赛库.db）。
//   node backend/美国/db/维护/批量归档/run.mjs --理由前缀 发布前还缺：该届已结束 --试跑   只列出会归哪些，比赛库只读打开
//   node backend/美国/db/维护/批量归档/run.mjs --理由前缀 发布前还缺：该届已结束          归档
//   --全部待审   不按理由挑，所有比赛最新一届的待人工审核都看（和 --理由前缀 二选一，必须给一个，免得手滑全归）
//   --json       最后多打一行完整结果（JSON），给核对用
import { openDb } from '../../index.mjs';
import { 批量归档 } from './index.mjs';

const 参数 = process.argv.slice(2);
const 取值 = 名 => {
  const i = 参数.findIndex(a => a === 名 || a.startsWith(`${名}=`));
  if (i < 0) return null;
  return 参数[i].includes('=') ? 参数[i].slice(参数[i].indexOf('=') + 1) : 参数[i + 1] ?? null;
};
const 试跑 = 参数.includes('--试跑') || 参数.includes('--dry-run');
const 理由前缀 = 取值('--理由前缀');
const 全部待审 = 参数.includes('--全部待审');
if (Boolean(理由前缀) === 全部待审) {
  console.error('要给 --理由前缀 <开头> 或 --全部待审（二选一）');
  process.exit(2);
}

const db = openDb({ readOnly: 试跑 });
try {
  const 结果 = 批量归档(db, { 试跑, 理由前缀: 全部待审 ? null : 理由前缀 });
  const 不动 = Object.entries(结果.不动).map(([k, v]) => `${k} ${v.length}`).join('，');
  console.log(`${new Date().toISOString()} 批量归档${试跑 ? '（试跑，没写）' : ''}${理由前缀 ? `（理由开头“${理由前缀}”）` : '（全部待审）'}：`
    + `看了 ${结果.看了} 届，归档 ${结果.归档了.length}，没过门槛 ${结果.没过门槛.length}，人工定过 ${结果.人工定过.length}，不动（${不动}），失败 ${结果.失败.length}`);
  for (const x of 结果.归档了) console.log(`  归档 ${x.id}（${x.名称}），依据 ${x.依据}`);
  for (const x of 结果.没过门槛) console.log(`  没过门槛 ${x.id}（${x.名称}）：${x.原因们.join('；')}`);
  for (const x of 结果.人工定过) console.log(`  人工定过 ${x.id}（${x.名称}）`);
  for (const x of 结果.失败) console.log(`  失败 ${x.id}：${x.原因}`);
  if (参数.includes('--json')) console.log(JSON.stringify(结果));
  if (结果.失败.length) process.exitCode = 1;
} finally {
  db.close();
}
