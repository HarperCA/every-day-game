// 入库总管：06 入库在流程里的这一步。只处理 05 审核通过的候选（程序审核 + 三项核验都过了；input 带 不审核 时另见下面），逐条：
//   对照主库（../对照主库/）→ 整理字段（../整理字段/）→ 发布门槛（美国/程序审核）→ 放进小数据库的待写入（交回 changes）
// 已截止的为已归档，其余为已发布（2026-11-01 用户定：过了才入库，没有待人工审核，也没有验收，写进主库就是发布）。
// 逐条做，是为了同一次两条候选指向同一个比赛、同一届时，后一条能看到前一条已经决定新建（不再建第二次）、已经补的来源（编号接着排）。
// 新一届入库时，被它替代的旧届次直接归档。
// 发布的届次缺报名网址时，用核验过的官方通知页顶上（程序审核的 报名网址顶上，2026-11-12）。
// 没放进待写入的标已丢弃，原因写“06 入库·哪一步”。真正写进主库是总控最后调的 写入主库（../写入主库/）。
//
// input 里可以另带（每晚流程不带，行为不变；入库指定网址 给新维护用时带，2026-11-08）：
//   更新已有：true 时，候选对上库里已有的一届（补来源 / 已处理过），用这条通知整理出的届次内容和库里那一届逐项比（../整理字段/比对届次.mjs），
//            确定事实（报名/比赛时间、报名网址、费用）不同就改，其余字段只在库里空着时补（2026-11-09，人工改过的同样规则），照样补来源；改动带读到的版本号，后台记录（audit_log，action '入库改届次'）留一条，
//            detail 写改了哪些字段、改前改后、依据网址。状态、顺序、编号这些不动。同一次几条改同一届，后一条在前一条改过的基础上比。
//   来源：写进后台记录的 detail.来源（例如“新维护”）；没给时写“每晚流程”。
//   不审核（2026-11-08 用户定“进行维护的时候不需要审核”“发现新的一届直接进行调换”）：true 时 05 没跑，候选没有 data.review，
//            处理 04 抽取过（有 data.extraction）、还没入库的候选（见下面 不审核的记录和来源）：
//            记录用 合成记录(item.data)（和 05 合成的一样，没有 Kimi 核验改正）；来源是这条通知网址和 04 补读到的正式通知，
//            按核验过的官方来源写（is_official、valid、organizer_notice，核对理由写明“维护不审核”，核对时间写 now）；
//            对上已有届次照上面 更新已有 比字段、补来源；新的一届不过发布门槛，直接新建（已截止的照旧归档，其余发布），旧届次照旧归档；
//            对出来是新比赛的丢弃（维护不新建比赛；带比赛编号时本来就不会走到这里）。
// 条目 data 里可以带 比赛编号：只在这个比赛下认届次，不按名字另建比赛；带 届次编号：直接用这一届，不按名字认，
// 这一届不存在或不属于比赛编号时这条标失败（见 ../对照主库/，2026-11-08）。
// 找新一届（2026-11-12 用户定“发现新一届就入库发布，追不到官方通知也用高校转发发布，标明来源”），条目 data 里还可以带：
//   新届 { 年份, 届次 }：程序已经核对过这是比库里最新一届新的一届。只建新一届：对上库里已有届次的丢弃（不动已有届次；同一次前面刚建的同一届照常补来源）；
//            届次名称不用抽取出来的名字，按比赛名加年份、届次拼（“2026年第十九届××”，没认出的部分不写），年份、届次也就按程序认的。
//   来源类型 'school_repost'（高校转发）：不审核时来源写成 source_type school_repost、is_official 假、validity_status valid，
//            记录先经 ../整理字段/高校转发.mjs 整理（学校名、我校学生、交学院的截止不当全国的；报名时间留空时 pending_announcement 为真），
//            新一届照常不卡门槛直接发布；报名网址不拿转发页顶上。发布门槛对这类届次也放行（美国/程序审核/发布门槛）。
//            对上已有届次（新维护官网打不开时用高校转发核对，2026-11-13 用户定）：开着更新已有也只补空，确定事实也不覆盖已有值（比对届次 的 只补空）。
//   核对说明：不审核时写进来源的 review_reason（没给用默认的）。
// 条目的 data.ingest：{ decision: 新比赛 / 新一届 / 补来源 / 已处理过, competitionId, editionId, status?, 改动: [{ 届次, 字段, 改前, 改后 }] }
import { randomUUID } from 'node:crypto';
import { 查发布, 报名网址顶上 } from '../../../../程序审核/index.mjs';
import { 对照主库 } from '../对照主库/index.mjs';
import { 整理字段, 拆名称, 已截止, 届次内容, 比对届次 } from '../整理字段/index.mjs';
import { 高校转发整理 } from '../整理字段/高校转发.mjs';
import { 网址键 } from '../../../common/网址键.mjs';
import { 合成记录 } from '../../../common/candidate.mjs';

export const meta = { title: '入库', version: 4 };
export const DEFAULT_PARTS = { 对照主库, 整理字段 };
const 前缀 = 步 => `06 入库·${步}：`;

// 要入库的：还在进行中、05 审核通过、还没入库过的候选；不审核时 05 没跑，要 04 抽取过的
const 要入库 = item => item.kind === 'candidate' && item.data?.review?.结果 === '通过' && !item.data?.ingest;
const 不审核要入库 = item => item.kind === 'candidate' && Boolean(item.data?.extraction) && !item.data?.ingest;

// 不审核（新维护用，2026-11-08）：没有 05 交的 data.review，记录、来源这样来
export const 不审核理由 = '新维护：出自已判断为官网的页面，维护不审核（2026-11-08 用户定）';
export const 高校转发理由 = '找新一届：高校转发的通知，没追到官方通知，不算官方来源（2026-11-12 用户定）';
const 高校转发 = 'school_repost';
const 合成字段 = ['organizer', 'participants', 'eligibility', 'format_and_rules', 'registration_start', 'registration_end', 'team_size', 'registration_method', 'fees'];
const 有值 = v => (typeof v === 'string' ? Boolean(v.trim()) : v !== null && v !== undefined);
//   记录：合成记录(item.data)，和 05 交给三项核验的那条一样（报名网址没抽到时是通知网址）。
//         pending_announcement 不写进记录：抽取不交这一项，对上已有届次时不拿它比；新建届次时按报名截止有没有补（没有就是“时间待公布”）。
//   来源们：这条通知网址 + 04 补读到的正式通知（04 记在 extraction.supplement 的 noticeUrl；合成记录里认的 supplement.notice 写法也认），
//           按来源表和发布门槛“核验过的官方来源”要的字段填齐：官方、有效、organizer_notice、标题、摘要、原文摘录、核对理由、支撑字段、核对时间。
//   改记录：来源算出来以前先改记录（找新一届的新届名称、高校转发整理）；高校转发：来源按高校转发写（见文件开头）
function 不审核的记录和来源(data, now, { 改记录 = 记录 => 记录, 转发 = false } = {}) {
  const 记录 = 改记录(合成记录(data));
  const 抽 = data.extraction || {};
  const 补读 = 抽.supplement?.used && 抽.supplement.noticeUrl ? [抽.supplement.noticeUrl] : [];
  const 键们 = new Set();
  const 网址们 = [...记录.sources.map(s => s.url), ...补读].filter(u => {
    const k = 网址键(u);
    if (!/^https?:\/\//i.test(u || '') || !k || 键们.has(k)) return false;
    键们.add(k);
    return true;
  });
  const 支撑 = ['name', ...合成字段.filter(f => 有值(记录[f]))];
  if (有值(data.registration_url)) 支撑.push('registration_url');
  const 引文 = Object.values(抽.fields || {}).filter(f => f && typeof f.quote === 'string' && f.quote.trim()).map(f => f.quote.trim()).join(' / ');
  const 名 = String(记录.name || data.name || '').trim();
  const 摘要 = `新维护读详情抽取（未经审核）：${名}${支撑.length > 1 ? `；抽到 ${支撑.slice(1).join('、')}` : ''}`;
  const at = now.toISOString();
  const 来源们 = 网址们.map(url => ({
    url, final_url: url, source_type: 转发 ? 高校转发 : 'organizer_notice', is_official: !转发, validity_status: 'valid',
    title: (url === data.url && String(data.title || '').trim() ? data.title.trim() : 名).slice(0, 200),
    content_summary: 摘要.slice(0, 2000), evidence_excerpt: (引文 || 名).slice(0, 20000),
    review_reason: String(data.核对说明 || '').trim() || (转发 ? 高校转发理由 : 不审核理由), supports_fields: 支撑, last_verified_at: at,
  }));
  return { 记录, 来源们 };
}

export function createRun(parts = DEFAULT_PARTS) {
  return async function run(input, ctx) {
    const now = ctx.now();
    const 不审核 = input.不审核 === true;
    const todo = (input.items || []).filter(不审核 ? (item => 要入库(item) || 不审核要入库(item)) : 要入库);
    const finished = new Map();
    const changes = [];
    const finish = (item, status, reason, ingest = null) =>
      finished.set(item.key, { key: item.key, kind: item.kind, status, data: ingest ? { ...item.data, ingest } : item.data, result: ingest?.decision || status, reason });

    const 更新已有 = Boolean(input.更新已有);
    const planned = new Map();     // 比赛编号 → { 下一个顺序, 届次们: [{ id, edition_year, edition_ordinal }] }：这一次决定新建的
    const 本次来源 = new Map();    // 届次编号 → { 键们, 数 }：这一次已经补进去的来源
    const 本次届次 = new Map();    // 届次编号 → { version, data }：这一次已经改过的已有届次（版本号仍是主库里读到的）
    const 读届次 = id => 本次届次.get(id) || ctx.view('edition', id);
    const 记来源 = (届次编号, 行们) => {
      const 有 = 本次来源.get(届次编号) || { 键们: new Set(), 数: 0 };
      for (const { data } of 行们) for (const k of [网址键(data.url), 网址键(data.final_url)]) if (k) 有.键们.add(k);
      本次来源.set(届次编号, { 键们: 有.键们, 数: 有.数 + 行们.length });
    };

    for (const item of todo) {
      if (ctx.signal?.aborted) { finish(item, '顺延', '停止信号：没来得及处理，下一晚接着做'); continue; }
      const key = item.key;
      const 通知网址 = item.data.url || key;
      const 新届 = item.data.新届 || null;
      const 转发 = item.data.来源类型 === 高校转发;
      const 整理说明 = [];
      // 找新一届：名称按比赛名加程序认出的年份、届次拼；高校转发再去掉学校自己的内容
      const 改记录 = 原 => {
        let 记录 = 原;
        const 比赛名 = 新届 && item.data.比赛编号 ? ctx.view('competition', item.data.比赛编号)?.data?.name : null;
        if (比赛名) 记录 = { ...记录, name: `${新届.年份 ? `${新届.年份}年` : ''}${新届.届次 || ''}${拆名称(比赛名).名称}` };
        if (转发) {
          const 整 = 高校转发整理(记录, { fields: item.data.extraction?.fields || {}, 通知网址 });
          整理说明.push(...整.说明);
          记录 = 整.记录;
        }
        return 记录;
      };
      const { 记录, 来源们 } = item.data.review?.结果 === '通过' ? item.data.review : 不审核的记录和来源(item.data, now, { 改记录, 转发 });
      try {
        const 对照 = await parts.对照主库(记录, ctx, planned, { 来源们, 比赛编号: item.data.比赛编号 || null, 届次编号: item.data.届次编号 || null, 本次来源, 仅新届次: Boolean(新届) || (!不审核 && !item.data.比赛编号 && !item.data.届次编号) });
        // 找新一届：只建新一届，对上库里已有的届次不动（同一次前面刚建的同一届照常补来源）
        if (新届 && 对照.kind !== '新一届' && !对照.本次新建) {
          finish(item, '已丢弃', `${前缀('对照主库')}找新一届：库里已有这一届（${对照.editionId || 对照.kind}），不动已有届次`);
          continue;
        }
        if (对照.kind === '补来源' || 对照.kind === '已处理过') {
          const 改 = 更新已有 && !对照.本次新建 ? 比对已有(对照, 记录, 通知网址, { 只补空: 转发 }) : null;
          const 改动 = 改?.改动 || [];
          const ingest = { decision: 对照.kind, competitionId: 对照.competitionId, editionId: 对照.editionId, 改动 };
          if (对照.kind === '已处理过' && !改动.length) { finish(item, '已丢弃', `${前缀('对照主库')}${对照.reason}`, ingest); continue; }
          let 补了 = 0;
          if (对照.kind === '补来源') {
            const draft = parts.整理字段({ 记录, 来源们: 对照.新来源们, 对照 });
            for (const s of draft.sources) changes.push({ table: 'source', key: s.id, op: 'insert', payload: s.data, itemKey: key });
            记来源(对照.editionId, draft.sources);
            补了 = draft.sources.length;
          }
          if (改动.length) {
            changes.push({ table: 'edition', key: 对照.editionId, op: 'update', payload: 改.payload, baseVersion: 改.version, itemKey: key });
            changes.push({ table: 'audit_log', key: randomUUID(), op: 'insert', itemKey: key, payload: {
              created_at: now.toISOString(), action: '入库改届次', table_name: 'edition', record_id: 对照.editionId,
              detail: { 比赛: 对照.competitionId, 改动: 改动.map(({ 字段, 改前, 改后 }) => ({ 字段, 改前, 改后 })), 依据网址: 通知网址,
                来源们: 来源们.map(s => s.url).filter(Boolean), 来源: input.来源 || '每晚流程' },
            } });
            本次届次.set(对照.editionId, { version: 改.version, data: 改.payload });
          }
          const 说明 = [对照.kind === '补来源' ? `已有这一届，补 ${补了} 条来源` : '已有这一届，来源也都有了', 改动.length ? `改 ${改动.length} 个字段（${改动.map(x => x.字段).join('、')}）` : ''];
          finish(item, '进行中', 说明.filter(Boolean).join('，'), ingest);
          continue;
        }
        // 不审核：维护不新建比赛（带比赛编号时对照主库不会交回新比赛；没带、名字又对不上才会走到这里）
        if (不审核 && 对照.kind === '新比赛') { finish(item, '已丢弃', `${前缀('对照主库')}维护不新建比赛（没对上已有比赛，不审核模式不新建）`); continue; }
        const 发现 = { 网址: 通知网址, 渠道们: item.data.渠道们 || [], 搜索词们: item.data.搜索词们 || [], 路线们: item.data.路线们 || [] };
        // 不审核时记录没经过三项核验，没有 pending_announcement：报名截止没抽到就是“时间待公布”（和三项核验的做法一样）
        const 建的记录 = 不审核 && typeof 记录.pending_announcement !== 'boolean' ? { ...记录, pending_announcement: !记录.registration_end } : 记录;
        const draft = parts.整理字段({ 记录: 建的记录, 来源们, 对照, 发现 });
        const 归档 = 已截止(draft.edition.data, now);
        const 门槛记录 = { ...记录, name: 拆名称(记录.name).名称, id: draft.edition.id, sources: draft.sources.map(s => ({ id: s.id, ...s.data })) };
        // 不审核（维护，2026-11-08 用户定“发现新的一届直接进行调换”）：不卡发布门槛
        if (!不审核) {
          const 门槛 = 查发布(门槛记录, { 归档 });
          if (门槛.结果 !== '通过') { finish(item, '已丢弃', `${前缀('发布门槛')}${门槛.原因们.join('；')}`); continue; }
        }
        const status = 归档 ? '已归档' : '已发布';
        // 发布时缺报名网址：用核验过的官方通知页顶上（2026-11-12 用户定；门槛只判断，填在这里）
        const 报名网址 = status === '已发布' && !draft.edition.data.registration_url ? 报名网址顶上(门槛记录) || null : draft.edition.data.registration_url;
        if (draft.competition) changes.push({ table: 'competition', key: draft.competition.id, op: 'insert', payload: draft.competition.data, itemKey: key });
        changes.push({ table: 'edition', key: draft.edition.id, op: 'insert', payload: { ...draft.edition.data, registration_url: 报名网址, status, status_at: now.toISOString(), status_reason: null }, itemKey: key });
        for (const s of draft.sources) changes.push({ table: 'source', key: s.id, op: 'insert', payload: s.data, itemKey: key });
        记来源(draft.edition.id, draft.sources);
        // 新一届入库时，被它替代的旧届次直接归档
        for (const oldId of 对照.supersedes || []) {
          const old = 读届次(oldId);
          if (old && old.data.status !== '已归档') {
            const payload = { ...old.data, status: '已归档', status_at: now.toISOString() };
            changes.push({ table: 'edition', key: oldId, op: 'update', payload, baseVersion: old.version, itemKey: key });
            本次届次.set(oldId, { version: old.version, data: payload });
          }
        }
        const competitionId = draft.competition?.id || 对照.competitionId;
        const { edition_year, edition_ordinal, ordinal } = draft.edition.data;
        planned.set(competitionId, { 下一个顺序: ordinal + 1, 届次们: [...(planned.get(competitionId)?.届次们 || []), { id: draft.edition.id, edition_year, edition_ordinal }] });
        const 说 = `${对照.kind}，${归档 ? '发现时已截止，归档' : 不审核 ? '维护不审核，发布' : '审核通过，发布'}${转发 ? `；高校转发${整理说明.length ? `（${整理说明.join('；')}）` : ''}` : ''}`;
        finish(item, '进行中', 说, { decision: 对照.kind, competitionId, editionId: draft.edition.id, status, 改动: [] });
      } catch (error) {
        finish(item, '失败', `${前缀('出错')}${String(error?.message || error).slice(0, 200)}`);
      }
    }

    // 更新已有：和库里那一届（或这一次已经改过的样子）比，交回 { 改动: [{ 届次, 字段, 改前, 改后 }], payload, version }；读不到或还没进主库的不比
    function 比对已有(对照, 记录, 通知网址, { 只补空 = false } = {}) {
      const 旧 = 读届次(对照.editionId);
      if (!旧 || !Number.isInteger(旧.version)) return null;
      const 比赛 = ctx.view('competition', 对照.competitionId)?.data || null;
      const 差 = 比对届次(旧.data, 届次内容(记录), { 比赛, 通知网址, 待公布写明: typeof 记录.pending_announcement === 'boolean', 只补空 });
      if (!差.length) return null;
      const payload = { ...旧.data };
      for (const { 字段, 改后 } of 差) payload[字段] = 改后;
      return { 改动: 差.map(x => ({ 届次: 对照.editionId, ...x })), payload, version: 旧.version };
    }

    const items = todo.map(item => finished.get(item.key));
    const count = status => items.filter(i => i.status === status).length;
    ctx.log.info(`入库 ${todo.length} 条：放进待写入 ${count('进行中')}，丢弃 ${count('已丢弃')}，顺延 ${count('顺延')}，失败 ${count('失败')}；改动 ${changes.length} 条`);
    return { items, changes, problems: count('失败') ? [`${count('失败')} 条入库失败`] : [] };
  };
}

export const run = createRun();
