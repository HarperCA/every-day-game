// 组装：把分流好的问题变成要写进比赛库的改动。不调接口，只读比赛库（拿现在的值和版本号）。
//
//   改正  改在问题所在的那条记录上（比赛或届次）；改“状态”时顺带记下状态时间；每处改正留一条操作日志
//   人工  标在届次上：状态改成待人工审核，理由加一条；比赛级字段的问题标在这场比赛最新的一届上
//         理由写成 “[维护·检查项] 字段：依据（建议：…；出处：…）”，同一检查项、同一字段已经有理由的不重复加
//   回收站  标记删除（30 天内可恢复），留一条“维护放回收站”；新增  插入一行（AI 审查加的来源），留一条“维护新增”
//   人工的 替换旧理由：同一检查项、同一字段的旧理由换成这一条（AI 审查每次都写最新的原因）
//   同一条记录的几处改动合成一次修改，带读到的版本号，提交时版本对不上就跳过
import { randomUUID } from 'node:crypto';

const 字段名 = p => (p.table === 'competition' ? `比赛.${p.字段}` : p.字段);
const 理由前缀 = p => `[维护·${p.检查项}] ${字段名(p)}：`;

export function 写理由(p) {
  const 建议 = p.改动 && Object.keys(p.改动).length ? `建议：${JSON.stringify(p.改动)}` : '';
  const 出处 = (p.出处 || []).filter(s => s?.网址).map(s => s.网址);
  const 括号 = [建议, 出处.length ? `出处：${出处.join('、')}` : ''].filter(Boolean).join('；');
  return `${理由前缀(p)}${p.人工原因 ? `${p.人工原因}；` : ''}${p.依据 || ''}${括号 ? `（${括号}）` : ''}`;
}

// 比赛级问题要标人工时，标在这场比赛最新的一届（已删除的读不到）
const 最新一届 = (db, competitionId) => db.find('edition', { competition_id: competitionId }, { orderBy: '-ordinal', limit: 1 })[0] || null;

export function 组装改动({ db, 改正们, 人工们, 回收们 = [], 新增们 = [], now }) {
  const at = now().toISOString();
  const 记录们 = new Map();   // "表/编号" → { table, key, 原版本, 原数据, payload }
  const 记录 = (table, key) => {
    const id = `${table}/${key}`;
    if (!记录们.has(id)) {
      const row = db.get(table, key);
      记录们.set(id, row ? { table, key, 原版本: row.version, 原数据: row.data, payload: {} } : null);
    }
    return 记录们.get(id);
  };
  const 日志 = [];
  const 标不了 = [];

  for (const p of 改正们) {
    const r = 记录(p.table, p.key);
    Object.assign(r.payload, p.改动);
    if ('status' in p.改动 && !('status_at' in p.改动)) r.payload.status_at = at;
    日志.push({ table: 'audit_log', key: randomUUID(), op: 'insert', payload: {
      created_at: at, action: '维护改正', table_name: p.table, record_id: p.key,
      detail: { 检查项: p.检查项, 字段: p.字段, 原值: p.现在的值 ?? r.原数据[p.字段] ?? null, 新值: p.改动, 依据: p.依据 || '', 出处: p.出处 || [] },
    } });
  }

  for (const p of 人工们) {
    const 届次 = p.table === 'edition' ? { id: p.key } : 最新一届(db, p.key);
    if (!届次) { 标不了.push({ ...p, 说明: '比赛下没有届次，标不了待人工审核' }); continue; }
    const r = 记录('edition', 届次.id);
    const 已有 = r.payload.status_reason || r.原数据.status_reason || [];
    const 同一项 = x => String(x).startsWith(理由前缀(p));
    if (!p.替换旧理由 && 已有.some(同一项)) continue;
    r.payload.status_reason = [...已有.filter(x => !同一项(x)), 写理由(p)];
    if ((r.payload.status || r.原数据.status) !== '待人工审核') { r.payload.status = '待人工审核'; r.payload.status_at = at; }
  }

  const 回收 = [];
  for (const p of 回收们) {
    const row = db.get(p.table, p.key);
    if (!row) continue;
    记录们.delete(`${p.table}/${p.key}`);
    回收.push({ table: p.table, key: p.key, op: 'trash', baseVersion: row.version, by: `维护·${p.检查项}`, at, ...(p.table === 'edition' && p.依据 ? { 理由: `[维护·${p.检查项}] 回收站：${p.依据}` } : {}) });
    日志.push({ table: 'audit_log', key: randomUUID(), op: 'insert', payload: {
      created_at: at, action: '维护放回收站', table_name: p.table, record_id: p.key,
      detail: { 检查项: p.检查项, 名称: row.data.edition_name ?? row.data.name ?? null, 依据: p.依据 || '', 出处: p.出处 || [] },
    } });
  }
  const 新增 = [];
  for (const p of 新增们) {
    新增.push({ table: p.table, key: p.key, op: 'insert', payload: p.行 });
    日志.push({ table: 'audit_log', key: randomUUID(), op: 'insert', payload: {
      created_at: at, action: '维护新增', table_name: p.table, record_id: p.key,
      detail: { 检查项: p.检查项, 依据: p.依据 || '', 出处: p.出处 || [] },
    } });
  }

  const 改动们 = [...记录们.values()].filter(r => r && Object.keys(r.payload).length)
    .map(r => ({ table: r.table, key: r.key, op: 'update', payload: r.payload, baseVersion: r.原版本 }));
  return { 改动们: [...改动们, ...新增, ...回收, ...日志], 标不了 };
}
