// 批量归档（2026-11-12 用户定）：每个比赛最新一届、还是待人工审核、报名已截止的，一次改成已归档。手动跑，不挂定时器。
// 起因：名录导入的届次里有一批“发布前还缺：该届已结束”的，报名早就截止了，一直挂在待人工审核。
// 写比赛库经 db/index.mjs 的 届次.待审归档（每一届一个事务、带版本号，理由接在原来的后面，后台记录 action “批量归档”）。
//
// 规则：
//   只看没删的比赛的最新一届（顺序最大、没删的那届），状态是待人工审核；给了理由前缀的，只看最后一条理由以它开头的。
//   截止依据(届次, now)：报名截止已过 → '报名截止'；没写报名截止、比赛结束已过 → '比赛结束'；
//     没过 → '没截止'；日期写坏了 → '日期写坏了'；两个都没有 → '没有日期'。只写日期的按北京时间当天 23:59:59 算（和每日归档一样）。
//   人工定过状态的（manual_fields 含 status）不动。
//   归档要过发布门槛的归档那几项（程序审核 查发布(记录, { 归档: true })：标题、范围、名称），过不了的不动，记下原因。
//
//   批量归档(db, { now, 试跑, 操作人, 理由前缀 })
//     → { 看了, 归档了: [{ id, 名称, 依据 }], 没过门槛: [{ id, 名称, 原因们 }], 人工定过: [{ id, 名称 }],
//         不动: { 没截止, 日期写坏了, 没有日期 }（各是 [{ id, 名称 }]）, 失败: [{ id, 原因 }] }
import { 届次 } from '../../index.mjs';
import { 查发布 } from '../../../程序审核/index.mjs';
import { 时刻 } from '../归档/index.mjs';

export function 截止依据(届, now = new Date()) {
  const t = now.getTime();
  const 截止 = 时刻(届.registration_end, 'end');
  if (截止 !== null) return !Number.isFinite(截止) ? '日期写坏了' : t > 截止 ? '报名截止' : '没截止';
  const 结束 = 时刻(届.competition_end, 'end');
  if (结束 !== null) return !Number.isFinite(结束) ? '日期写坏了' : t > 结束 ? '比赛结束' : '没截止';
  return '没有日期';
}

// 北京时间的日期，写进理由
const 北京日期 = now => new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const 理由 = (依据, now) => `${北京日期(now)} 批量归档：报名已截止${依据 === '比赛结束' ? '（没写报名截止，按比赛结束算）' : ''}`;

// 比赛和届次合成一条记录给门槛看：届次有值的盖过比赛的，名称用比赛的
function 合并(比赛, 届) {
  const 记录 = { ...比赛 };
  for (const [键, 值] of Object.entries(届)) if (值 != null || !(键 in 记录)) 记录[键] = 值;
  return { ...记录, name: 比赛.name, id: 届.id };
}

// 每个没删的比赛的最新一届（顺序最大、没删的那届）
function 最新届次们(db) {
  const 比赛们 = new Map(db.find('competition', {}).map(c => [c.id, c]));
  const 最新 = new Map();
  for (const e of db.find('edition', {}, { orderBy: 'id' })) {
    if (!比赛们.has(e.competition_id)) continue;
    const 有 = 最新.get(e.competition_id);
    if (!有 || e.ordinal > 有.ordinal) 最新.set(e.competition_id, e);
  }
  return [...最新.values()].map(e => ({ 届: e, 比赛: 比赛们.get(e.competition_id) })).sort((a, b) => a.届.id.localeCompare(b.届.id));
}

export function 批量归档(db, { now = new Date(), 试跑 = false, 操作人 = '批量归档', 理由前缀 = null } = {}) {
  const 要看的 = 最新届次们(db).filter(({ 届 }) => 届.status === '待人工审核'
    && (!理由前缀 || String((届.status_reason || []).at(-1) ?? '').startsWith(理由前缀)));
  const 结果 = { 看了: 要看的.length, 归档了: [], 没过门槛: [], 人工定过: [], 不动: { 没截止: [], 日期写坏了: [], 没有日期: [] }, 失败: [] };
  for (const { 届, 比赛 } of 要看的) {
    const 名称 = 届.edition_name;
    const 依据 = 截止依据(届, now);
    if (结果.不动[依据]) { 结果.不动[依据].push({ id: 届.id, 名称 }); continue; }
    if ((届.manual_fields || []).includes('status')) { 结果.人工定过.push({ id: 届.id, 名称 }); continue; }
    const 门槛 = 查发布(合并(比赛, 届), { 归档: true });
    if (门槛.结果 !== '通过') { 结果.没过门槛.push({ id: 届.id, 名称, 原因们: 门槛.原因们 }); continue; }
    try {
      if (!试跑) 届次.待审归档(db, 届.id, 届.version, { 理由: 理由(依据, now) }, { 操作人, at: now.toISOString() });
      结果.归档了.push({ id: 届.id, 名称, 依据 });
    } catch (错误) {
      // 一届出错（比如刚被人改过、版本号对不上）不挡别的，再跑一次就行
      结果.失败.push({ id: 届.id, 原因: String(错误?.message || 错误).slice(0, 200) });
    }
  }
  return 结果;
}
