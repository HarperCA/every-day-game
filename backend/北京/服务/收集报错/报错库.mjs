// 报错库：收集报错自己的库文件（默认 DB_DIR/报错日志.db，不进 git），2026-11-02。
// 不放副数据库：副数据库是用户管理中心，每张表都挂在用户下（2026-11-01 定）；报错和加载统计是匿名的，不属于任何用户。
// 两张表的字段名照旧（上海云开发的 client_issues、client_stats），美国的“访问异常”页以后同步过去时可以原样用旧的汇总代码。
//
//   打开报错库(file) → { 收下(条目们), 全部(), 加一(日期, 动作), 统计(从哪天, 到哪天), 之后(编号, 条数), 全部统计(), 写统计(日期, list, get), 关闭() }
//     写统计：搬旧数据用（北京/搬旧数据/），某天的次数直接写成给的数
//     之后、全部统计：给用户数据同步读（沟通/用户数据同步/，2026-11-02），报错带编号按编号接着推；统计每天一行
//     收下：sanitize.js 清洗过的条目；加一：动作只有 list（首页列表）、get（详情），日期是北京时间的 YYYY-MM-DD
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSqlite } from '../../../共用/工具/sqlite.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const 默认文件 = () => path.join(process.env.DB_DIR || path.join(HERE, '数据'), '报错日志.db');
// sanitize.js 交出来的字段，原样一列一个
const 字段们 = ['kind', 'received_at', 'client_id', 'at', 'page', 'action', 'message', 'extra', 'networkType', 'platform', 'system', 'wechatVersion', 'sdkVersion', 'appVersion', 'envVersion', 'elapsed_ms'];
const 动作们 = ['list', 'get'];

export function 打开报错库(file = 默认文件()) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = openSqlite(file);
  db.exec(`CREATE TABLE IF NOT EXISTS client_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, ${字段们.map(f => `"${f}"`).join(', ')});
    CREATE INDEX IF NOT EXISTS client_issues_at ON client_issues(at);
    CREATE TABLE IF NOT EXISTS client_stats (date TEXT PRIMARY KEY, list INTEGER NOT NULL DEFAULT 0, get INTEGER NOT NULL DEFAULT 0);`);
  const 插 = db.prepare(`INSERT INTO client_issues (${字段们.map(f => `"${f}"`).join(', ')}) VALUES (${字段们.map(f => `@${f}`).join(', ')})`);
  const 收下 = db.transaction(条目们 => { for (const item of 条目们) 插.run(Object.fromEntries(字段们.map(f => [f, item[f] ?? null]))); return 条目们.length; });
  return {
    收下,
    全部: () => db.prepare('SELECT * FROM client_issues ORDER BY id').all().map(({ id: _id, ...行 }) => 行),
    加一(日期, 动作) {
      if (!动作们.includes(动作)) throw new Error(`不认识的动作：${动作}`);
      db.prepare(`INSERT INTO client_stats (date, ${动作}) VALUES (?, 1) ON CONFLICT(date) DO UPDATE SET ${动作} = ${动作} + 1`).run(日期);
    },
    统计: (从, 到) => db.prepare('SELECT date, list, get FROM client_stats WHERE date BETWEEN ? AND ? ORDER BY date').all(从, 到),
    之后: (编号, 条数) => db.prepare('SELECT * FROM client_issues WHERE id > ? ORDER BY id LIMIT ?').all(编号, 条数),
    全部统计: () => db.prepare('SELECT date, list, get FROM client_stats ORDER BY date').all(),
    写统计: (日期, list, get) => db.prepare('INSERT INTO client_stats (date, list, get) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET list = excluded.list, get = excluded.get').run(日期, Number(list) || 0, Number(get) || 0),
    关闭: () => db.close(),
  };
}
