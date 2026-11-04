// 入库总管：06 入库在流程里的这一步。只处理 05 审核通过的候选（程序审核 + 三项核验都过了），逐条：
//   对照主库（../对照主库/）→ 整理字段（../整理字段/）→ 发布门槛（美国/程序审核）→ 放进小数据库的待写入（交回 changes）
// 已截止的为已归档，其余为已发布（2026-11-01 用户定：过了才入库，没有待人工审核，也没有验收，写进主库就是发布）。
// 逐条做，是为了同一晚两条候选指向同一个比赛时，第二条能看到第一条已经决定新建。新一届入库时，被它替代的旧届次直接归档。
// 没放进待写入的标已丢弃，原因写“06 入库·哪一步”。真正写进主库是总控最后调的 写入主库（../写入主库/）。
import { 查发布 } from '../../../../程序审核/index.mjs';
import { 对照主库 } from '../对照主库/index.mjs';
import { 整理字段, 拆名称, 已截止 } from '../整理字段/index.mjs';

export const meta = { title: '入库', version: 3 };
export const DEFAULT_PARTS = { 对照主库, 整理字段 };
const 前缀 = 步 => `06 入库·${步}：`;

// 要入库的：还在进行中、05 审核通过、还没入库过的候选
const 要入库 = item => item.kind === 'candidate' && item.data?.review?.结果 === '通过' && !item.data?.ingest;

export function createRun(parts = DEFAULT_PARTS) {
  return async function run(input, ctx) {
    const now = ctx.now();
    const todo = (input.items || []).filter(要入库);
    const finished = new Map();
    const changes = [];
    const finish = (item, status, reason, ingest = null) =>
      finished.set(item.key, { key: item.key, kind: item.kind, status, data: ingest ? { ...item.data, ingest } : item.data, result: ingest?.decision || status, reason });

    const planned = new Map();
    for (const item of todo) {
      if (ctx.signal?.aborted) { finish(item, '顺延', '停止信号：没来得及处理，下一晚接着做'); continue; }
      const { 记录, 来源们 } = item.data.review;
      const key = item.key;
      try {
        const 对照 = await parts.对照主库(记录, ctx, planned, { 来源们 });
        if (对照.kind === '已处理过') { finish(item, '已丢弃', `${前缀('对照主库')}${对照.reason}`); continue; }
        const 发现 = { 网址: item.data.url || key, 渠道们: item.data.渠道们 || [], 搜索词们: item.data.搜索词们 || [], 路线们: item.data.路线们 || [] };
        const draft = parts.整理字段({ 记录, 来源们: 对照.kind === '补来源' ? 对照.新来源们 : 来源们, 对照, 发现 });
        if (对照.kind === '补来源') {
          for (const s of draft.sources) changes.push({ table: 'source', key: s.id, op: 'insert', payload: s.data, itemKey: key });
          finish(item, '进行中', `已有这一届，补 ${draft.sources.length} 条来源`, { decision: '补来源', competitionId: 对照.competitionId, editionId: 对照.editionId });
          continue;
        }
        const 归档 = 已截止(draft.edition.data, now);
        const 门槛 = 查发布({ ...记录, name: 拆名称(记录.name).名称, id: draft.edition.id, sources: draft.sources.map(s => ({ id: s.id, ...s.data })) }, { 归档 });
        if (门槛.结果 !== '通过') { finish(item, '已丢弃', `${前缀('发布门槛')}${门槛.原因们.join('；')}`); continue; }
        const status = 归档 ? '已归档' : '已发布';
        if (draft.competition) changes.push({ table: 'competition', key: draft.competition.id, op: 'insert', payload: draft.competition.data, itemKey: key });
        changes.push({ table: 'edition', key: draft.edition.id, op: 'insert', payload: { ...draft.edition.data, status, status_at: now.toISOString(), status_reason: null }, itemKey: key });
        for (const s of draft.sources) changes.push({ table: 'source', key: s.id, op: 'insert', payload: s.data, itemKey: key });
        // 新一届入库时，被它替代的旧届次直接归档
        for (const oldId of 对照.supersedes || []) {
          const old = ctx.view('edition', oldId);
          if (old && old.data.status !== '已归档') {
            changes.push({ table: 'edition', key: oldId, op: 'update', payload: { ...old.data, status: '已归档', status_at: now.toISOString() }, baseVersion: old.version, itemKey: key });
          }
        }
        const competitionId = draft.competition?.id || 对照.competitionId;
        planned.set(competitionId, { 下一个顺序: draft.edition.data.ordinal + 1 });
        finish(item, '进行中', `${对照.kind}，${归档 ? '发现时已截止，归档' : '审核通过，发布'}`, { decision: 对照.kind, competitionId, editionId: draft.edition.id, status });
      } catch (error) {
        finish(item, '失败', `${前缀('出错')}${String(error?.message || error).slice(0, 200)}`);
      }
    }

    const items = todo.map(item => finished.get(item.key));
    const count = status => items.filter(i => i.status === status).length;
    ctx.log.info(`入库 ${todo.length} 条：放进待写入 ${count('进行中')}，丢弃 ${count('已丢弃')}，顺延 ${count('顺延')}，失败 ${count('失败')}；改动 ${changes.length} 条`);
    return { items, changes, problems: count('失败') ? [`${count('失败')} 条入库失败`] : [] };
  };
}

export const run = createRun();
