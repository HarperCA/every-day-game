// 建库 · 转换（纯计算，不碰数据库）：把旧总表的记录排成“要写进新库的东西”和“处理过程中的每一个问题”。
//
//   排计划(旧记录们, { 导出时间 }) → { 比赛们, 届次们, 来源们, 处理记录们, 合并组们, 编号对照, 问题们 }
//
// 规矩：
// - 字段按 描述/ 里每个字段的“旧”名对上；描述改了这里自动跟着变。
// - 不猜：空字符串当作没填；原文只写日期的时间原样存；数字写成文字的才转数字。
// - 不丢：选填字段过不了校验，原值移进届次的 legacy.未通过校验，字段留空，记一条问题；必填字段过不了就整条不搬，记一条问题。
// - 合并：同一 eventId 的、名称规范化后完全一样的，合成同一个比赛；合并理由写进计划，报告里逐个列出给人看。
// - 拆开：旧记录的上级比赛就是它自己的 eventId（传智杯 16 个赛道都挂在 event-list-c13 上），说明它是下级比赛借用了上级的编号，
//   拆成独立的比赛：编号把届次编号的 edition- 换成 event-，上级比赛指向原 eventId。
// - 同一个比赛里两条记录写的是同一届（第几届相同），照样搬成两届，报告里标出来给人定留哪条。
import { TABLES, validate } from '../index.mjs';

const 届次表 = TABLES.edition;
const 比赛表 = TABLES.competition;
const 来源表 = TABLES.source;

// 旧字段名 → 处理记录的 kind（取自 描述/表/比赛数据/处理记录.mjs 的“旧”）
const 处理记录对照 = {
  aiReview: 'ai_review', aiReviewFailure: 'ai_review_failure', aiResolution: 'ai_resolution', aiResolutionFailure: 'ai_resolution_failure',
  fieldVerification: 'field_verification', fieldVerificationFailure: 'field_verification_failure', fieldVerificationResolution: 'field_verification_resolution',
  aiFieldVerification: 'ai_field_verification', aiProfessionClassification: 'ai_profession_classification',
};
// 原样放进 legacy 的旧字段：取自 描述/ 里 legacy 字段的“旧”（旧的审核字段、追溯任务状态等，2026-10-31 起包括全部旧审核字段）
const 原样保留 = String(届次表.字段.legacy.旧).split('/').map(s => s.trim()).filter(Boolean);
// 这些字段由下面的代码单独算，不按“旧”名直接搬
const 单独处理 = new Set(['id', 'competition_id', 'ordinal', 'level', 'organizer', 'version', 'created_at', 'updated_at', 'legacy', 'status', 'status_reason', 'status_at']);
// 旧的数据状态 → 新的三种状态（2026-10-31 用户定）。旧数据只有 published、archived、draft 三种；其余的也按待人工审核
const 新状态 = { published: '已发布', archived: '已归档' };
const 官网类来源 = new Set(['organizer_website', 'official_website', 'organizer_official_website']);
const 代表优先 = { published: 0, archived: 1, draft: 2 };

export const 规范名 = s => String(s ?? '').normalize('NFKC').replace(/\s/g, '').toLowerCase();
const 取 = (对象, 路径) => 路径.split('.').reduce((v, k) => (v == null ? undefined : v[k]), 对象);
const 有值 = v => v !== undefined && v !== null && v !== '';
const 是时间 = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));

// 按字段类型做不改意思的规整：空字符串当没填；文字写的数字转数字；数字写的年份转文字
function 规整(字段, 值) {
  if (!有值(值)) return null;
  if ((字段.类型 === '整数' || 字段.类型 === '时间戳') && typeof 值 === 'string' && /^-?\d+$/.test(值.trim())) return Number(值.trim());
  if ((字段.类型 === '文字' || 字段.类型 === '长文字') && typeof 值 === 'number') return String(值);
  return 值;
}

function 年份(记录) {
  const 文字 = String(记录.editionYear ?? '');
  const m = 文字.match(/\d{4}/) || String(记录.schedule?.registration_end || 记录.schedule?.registration_start || '').match(/^\d{4}/);
  return m ? Number(m[0]) : 9999;
}

// 并查集：同 eventId、同规范名的记录并成一组
function 分组(记录们) {
  const 父 = 记录们.map((_, i) => i);
  const 找 = i => (父[i] === i ? i : (父[i] = 找(父[i])));
  const 并 = (a, b) => { 父[找(a)] = 找(b); };
  const 理由 = new Map();
  const 按键 = (键名, 取键) => {
    const 首个 = new Map();
    记录们.forEach((r, i) => {
      const k = 取键(r);
      if (!k) return;
      if (首个.has(k)) { 并(i, 首个.get(k)); if (!理由.has(i)) 理由.set(i, 键名); } else 首个.set(k, i);
    });
  };
  按键('同一 eventId', r => r.eventId);
  按键('名称相同', r => 规范名(r.name));
  const 组 = new Map();
  记录们.forEach((r, i) => { const g = 找(i); if (!组.has(g)) 组.set(g, []); 组.get(g).push({ 记录: r, 理由: 理由.get(i) || null }); });
  return [...组.values()];
}

// 第几届：先看 editionOrdinal，没有再从届次全称里找“第X届”
const 第几届 = r => String(r.editionOrdinal || String(r.editionName || '').match(/第[一二三四五六七八九十百零〇\d]+届/)?.[0] || '').replace(/^第|届$/g, '');

// 借用上级编号的下级比赛：上级比赛就是自己的 eventId，拆成独立比赛
const 借用上级编号 = r => 有值(r.parentEventId) && r.parentEventId === r.eventId;
export const 拆出的编号 = r => String(r.id).replace(/^edition-/, 'event-');

export function 排计划(原记录们, { 导出时间 = new Date().toISOString() } = {}) {
  const 问题们 = [];
  const 拆开们 = [];
  const 记录们 = 原记录们.map(r => {
    if (!借用上级编号(r)) return r;
    拆开们.push({ 届次: r.id, 名称: r.name, 新编号: 拆出的编号(r), 上级: r.parentEventId });
    return { ...r, eventId: 拆出的编号(r) };
  });
  const 记问题 = (届次, 字段, 处理, 原值) => 问题们.push({ 届次, 字段, 处理, 原值: 原值 === undefined ? undefined : JSON.stringify(原值)?.slice(0, 160) });

  const 组们 = 分组(记录们).map(成员 => {
    const 排好 = [...成员].sort((a, b) => 年份(a.记录) - 年份(b.记录)
      || (Date.parse(a.记录.schedule?.registration_end) || Infinity) - (Date.parse(b.记录.schedule?.registration_end) || Infinity)
      || String(a.记录.id).localeCompare(String(b.记录.id)));
    const 代表 = [...成员].map(m => m.记录).sort((a, b) => (代表优先[a.dataStatus] ?? 9) - (代表优先[b.dataStatus] ?? 9)
      || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
    return { 成员: 排好, 代表, 编号: 代表.eventId };
  });
  const 编号对照 = Object.fromEntries(组们.flatMap(g => g.成员.map(m => [m.记录.eventId, g.编号])));
  // 拆出来的下级比赛，上级仍是原来那个 eventId（它自己所在的组）
  for (const r of 原记录们) if (借用上级编号(r) && !编号对照[r.parentEventId]) 编号对照[r.parentEventId] = r.parentEventId;

  const 比赛们 = [], 届次们 = [], 来源们 = [], 处理记录们 = [], 合并组们 = [];
  const 用过的来源编号 = new Set();

  for (const 组 of 组们) {
    const r0 = 组.代表;
    const 全部记录 = 组.成员.map(m => m.记录);
    // ---- 比赛（一级）：取代表那一届（已发布 > 已归档 > 草稿，再看最近修改）的值 ----
    const 别名 = [...new Set(全部记录.flatMap(r => [...(Array.isArray(r.aliases) ? r.aliases : []), r.name]).filter(n => 有值(n) && 规范名(n) !== 规范名(r0.name)))];
    const 官网 = 全部记录.flatMap(r => r.sources || []).find(s => 官网类来源.has(s.source_type) && s.validity_status === 'valid' && /^https?:\/\//.test(s.url || ''))?.url || null;
    const 时间们 = 全部记录.flatMap(r => [r.createdAt, r.firstSeenAt, r.updatedAt]).filter(是时间).sort();
    const 比赛 = {
      name: r0.name, aliases: 别名.length ? 别名 : null, website: 官网,
      parent_id: null, level: r0.eventLevel || '其他/未明确', organizer: 规整(比赛表.字段.organizer, r0.organizer),
      region: 规整(比赛表.字段.region, r0.region), professions: r0.professions?.length ? r0.professions : null,
      objective_tags: r0.objectiveTags?.length ? r0.objectiveTags : null, lifecycle: 规整(比赛表.字段.lifecycle, r0.lifecycle),
      recognition: r0.recognition?.length ? r0.recognition : null, curation_list: 规整(比赛表.字段.curation_list, r0.curationList),
      version: 1, created_at: 时间们[0] || 导出时间, updated_at: 时间们.at(-1) || 导出时间,
    };
    const 上级 = 全部记录.map(r => r.parentEventId).find(有值);
    if (上级) {
      const 映射 = 编号对照[上级];
      if (!映射) 记问题(组.编号, 'parent_id', '上级比赛在旧数据里找不到，留空', 上级);
      else if (映射 === 组.编号) 记问题(组.编号, 'parent_id', '上级比赛合并后就是它自己，留空', 上级);
      else 比赛.parent_id = 映射;
    }
    for (const p of validate(比赛表, { id: 组.编号, ...比赛 })) {
      if (比赛表.字段[p.field]?.必填) 记问题(组.编号, p.field, `比赛的必填字段过不了校验：${p.message}`, 比赛[p.field]);
      else { 记问题(组.编号, p.field, `比赛字段过不了校验，留空：${p.message}`, 比赛[p.field]); 比赛[p.field] = null; }
    }
    比赛们.push({ id: 组.编号, data: 比赛 });

    if (组.成员.length > 1) {
      const 不同 = 字段 => [...new Set(全部记录.map(r => r[字段] ?? ''))];
      合并组们.push({
        编号: 组.编号, 名称: r0.name,
        旧eventId们: [...new Set(全部记录.map(r => r.eventId))],
        届次们: 组.成员.map(m => ({ id: m.记录.id, 年份: m.记录.editionYear ?? '', 第几届: 第几届(m.记录), 状态: m.记录.dataStatus, 届次名: m.记录.editionName, 理由: m.理由 })),
        同一届重复: (() => { const 届 = 组.成员.map(m => 第几届(m.记录)).filter(Boolean); return [...new Set(届.filter((x, i) => 届.indexOf(x) !== i))]; })(),
        级别不同: 不同('eventLevel').length > 1 ? 不同('eventLevel') : null,
        主办方不同: 不同('organizer').length > 1 ? 不同('organizer') : null,
      });
    }

    // ---- 届次（二级） ----
    组.成员.forEach(({ 记录: r }, 序号) => {
      const legacy = {};
      const 届次 = { competition_id: 组.编号, ordinal: 序号 + 1 };
      for (const [名, 字段] of Object.entries(届次表.字段)) {
        if (单独处理.has(名) || !字段.旧) continue;
        届次[名] = 规整(字段, 取(r, 字段.旧));
      }
      // 级别、主办方：和比赛一样的不填（二级不填就用一级）
      届次.level = null;
      届次.organizer = null;
      if (有值(r.eventLevel) && r.eventLevel !== 比赛.level) 届次.level = r.eventLevel;
      if (有值(r.organizer) && r.organizer !== 比赛.organizer) 届次.organizer = r.organizer;
      // 两条“报名截止说明”并进时间说明
      if (有值(r.schedule?.registration_end_note)) 届次.time_note = [届次.time_note, `（报名截止说明）${r.schedule.registration_end_note}`].filter(有值).join('\n');
      // 状态：已发布、已归档照旧；其余改成待人工审核并写明理由。状态时间取发布、归档、首次发现的时间，没有就用最后修改时间
      届次.status = 新状态[r.dataStatus] || '待人工审核';
      届次.status_reason = 届次.status === '待人工审核' ? [`旧系统的${r.dataStatus === 'draft' ? '草稿' : `“${r.dataStatus || '没写状态'}”记录`}，未审核`] : null;
      届次.status_at = [{ 已发布: r.publishedAt, 已归档: r.archivedAt, 待人工审核: r.firstSeenAt }[届次.status], r.updatedAt].find(是时间) || 导出时间;
      for (const k of 原样保留) if (r[k] !== undefined) legacy[k] = r[k];
      if (!有值(届次.edition_name)) { 届次.edition_name = r.name; 记问题(r.id, 'edition_name', '届次全称是空的，用比赛名称代替'); }
      届次.created_at = [r.createdAt, r.firstSeenAt, r.updatedAt].find(是时间) || 导出时间;
      届次.updated_at = 是时间(r.updatedAt) ? r.updatedAt : 导出时间;
      届次.version = 1;

      let 跳过 = false;
      for (const p of validate(届次表, { id: r.id, ...届次, legacy: Object.keys(legacy).length ? legacy : null })) {
        if (届次表.字段[p.field]?.必填) { 记问题(r.id, p.field, `必填字段过不了校验，这一届不搬：${p.message}`, 届次[p.field]); 跳过 = true; continue; }
        (legacy.未通过校验 ||= {})[p.field] = 届次[p.field];
        记问题(r.id, p.field, `过不了校验，原值移进 legacy.未通过校验：${p.message}`, 届次[p.field]);
        届次[p.field] = null;
      }
      if (跳过) return;

      // ---- 来源 ----
      (r.sources || []).forEach((s, i) => {
        let id = 有值(s.id) ? String(s.id) : `${r.id}-source-${i + 1}`;
        if (用过的来源编号.has(id)) { 记问题(r.id, 'source.id', `来源编号重复，改成 ${id}-${i + 1}`, id); id = `${id}-${i + 1}`; }
        用过的来源编号.add(id);
        const 来源 = {};
        for (const [名, 字段] of Object.entries(来源表.字段)) if (名 !== 'id' && 字段.旧) 来源[名] = 规整(字段, 取(s, 字段.旧));
        if (s.edition_id && s.edition_id !== r.id) 记问题(r.id, 'source.edition_id', '来源上写的届次和所在记录不一致，按所在记录', s.edition_id);
        来源.edition_id = r.id;
        for (const p of validate(来源表, { id, ...来源 })) {
          if (来源表.字段[p.field]?.必填) { 记问题(r.id, `source.${p.field}`, `来源 ${id} 的必填字段过不了校验，这条来源不搬，原样移进 legacy`, 来源[p.field]); (legacy.未搬的来源 ||= []).push(s); return; }
          ((legacy.未通过校验 ||= {}).来源 ||= {})[`${id}.${p.field}`] = 来源[p.field];
          记问题(r.id, `source.${p.field}`, `来源 ${id} 的字段过不了校验，原值移进 legacy.未通过校验`, 来源[p.field]);
          来源[p.field] = null;
        }
        来源们.push({ id, data: 来源 });
      });

      // ---- 处理记录 ----
      for (const [旧, kind] of Object.entries(处理记录对照)) {
        const 值 = r[旧];
        if (!有值(值)) continue;
        const detail = typeof 值 === 'object' ? 值 : { 值 };
        const at = [detail.reviewed_at, detail.at, detail.lastAt, detail.failedAt, detail.resolved_at, r.updatedAt].find(是时间) || 导出时间;
        处理记录们.push({ id: `${r.id}-${kind}`, data: { edition_id: r.id, kind, at, run_id: null, detail } });
      }

      届次.legacy = Object.keys(legacy).length ? legacy : null;
      届次们.push({ id: r.id, data: 届次 });
    });
  }
  return { 比赛们, 届次们, 来源们, 处理记录们, 合并组们, 拆开们, 编号对照, 问题们 };
}
