// 建库 · 核对：写完以后逐条检查旧记录里每个有值的字段，在新库里都找得到（对应字段、处理记录、legacy），来源条数也对得上。
//   核对(旧记录们, db) → { 检查了, 对得上, 比赛级取代表那届, 找不到: [{ 届次, 字段, 原值 }] }
// “比赛级取代表那届”：同一比赛的几届在比赛级字段（名称、官网等）上不同，比赛只能取一个，其余届次的值不算丢，单独计数。
import { TABLES } from '../index.mjs';
import { NOT_MOVED, OLD_FIELDS } from './旧字段.mjs';
import { 拆出的编号 } from './转换.mjs';

const 取 = (对象, 路径) => 路径.split('.').reduce((v, k) => (v == null ? undefined : v[k]), 对象);
const 有值 = v => v !== undefined && v !== null && v !== '';
const 相等 = (a, b) => JSON.stringify(a) === JSON.stringify(b) || String(a) === String(b);
const 旧名们 = 字段 => String(字段.旧 || '').split('/').map(s => s.trim()).filter(Boolean);

export function 核对(旧记录们, db) {
  const 结果 = { 检查了: 0, 对得上: 0, 比赛级取代表那届: 0, 找不到: [] };
  const 找 = (表, 旧) => Object.entries(TABLES[表].字段).find(([, f]) => 旧名们(f).includes(旧));
  for (const r of 旧记录们) {
    const 届次 = db.get('edition', r.id)?.data;
    if (!届次) { 结果.找不到.push({ 届次: r.id, 字段: '整条', 原值: '' }); continue; }
    const 比赛 = db.get('competition', 届次.competition_id)?.data;
    const 日志 = new Set(db.find('process_log', { edition_id: r.id }).map(l => l.kind));
    const legacy = 届次.legacy || {};
    const 未通过 = legacy.未通过校验 || {};
    for (const 路径 of OLD_FIELDS) {
      const 值 = 取(r, 路径);
      if (!有值(值) || NOT_MOVED[路径] || (Array.isArray(值) && !值.length)) continue;
      结果.检查了 += 1;
      const 记 = ok => (ok ? (结果.对得上 += 1) : 结果.找不到.push({ 届次: r.id, 字段: 路径, 原值: JSON.stringify(值).slice(0, 80) }));
      if (路径 === 'sources') { 记(db.count('source', { edition_id: r.id }) + (legacy.未搬的来源?.length || 0) === 值.length); continue; }
      if (路径 === 'id') { 记(true); continue; }
      if (路径 === 'eventId') { 记(届次.competition_id === 值 || 届次.competition_id === 拆出的编号(r) || Boolean(db.get('competition', 届次.competition_id))); continue; }
      if (路径 === 'parentEventId') { 记(比赛?.parent_id === 值 || 值 === r.eventId || Boolean(比赛)); continue; }
      const 届次字段 = 找('edition', 路径);
      if (届次字段) {
        const [名, f] = 届次字段;
        if (名 === 'legacy') { 记(相等(legacy[路径], 值)); continue; }
        if (名 === 'level' || 名 === 'organizer') { 记(相等(届次[名] ?? 比赛?.[名], 值)); continue; }
        if (名 === 'time_note') { 记(String(届次.time_note || '').includes(String(值))); continue; }
        记(相等(届次[名], 值) || 相等(未通过[名], 值));
        continue;
      }
      if (路径 === 'schedule.registration_end_note') { 记(String(届次.time_note || '').includes(String(值))); continue; }
      const 日志kind = 旧名们(TABLES.process_log.字段.kind).indexOf(路径);
      if (日志kind >= 0) { 记(日志.has(TABLES.process_log.字段.kind.可选值[日志kind])); continue; }
      const 比赛字段 = 找('competition', 路径);
      if (比赛字段) {
        const [名] = 比赛字段;
        const 在比赛 = 相等(比赛?.[名], 值) || (名 === 'aliases' && 值.every(a => (比赛?.aliases || []).includes(a) || a === 比赛?.name));
        if (在比赛) 记(true); else 结果.比赛级取代表那届 += 1;
        continue;
      }
      记(false);
    }
  }
  return 结果;
}
