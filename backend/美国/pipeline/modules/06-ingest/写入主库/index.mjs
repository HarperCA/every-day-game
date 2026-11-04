// 写入主库：06 入库给总控提供的调取函数。整条流程跑完后，总控调它，把小数据库里待写入的改动用主库的事务写进主库。
// 没有验收：写进主库就是发布（2026-11-01 用户定）。搬自原来 总控/零件/commit.mjs，改成由 06 提供，并加上两条：
//   一条候选的改动一组写：主库按字段规则校验（必填、可选值、长度……），有一项不合格，这条候选的改动全都不写（不会只写进一半），
//   候选在小数据库里标已丢弃，原因写“06 入库·写入主库：字段不合格：……”；别的候选照写；
//   拒过的网址（03 筛选、05 审核记的）不看所属条目的状态：本来就是丢弃的条目才记。
//
//   写入主库({ 小数据库, 主库, log, 试跑 }) → { total, written, conflicts, rejected, dryRun, error, wouldWrite? }
//
// 一条改动要同时满足这几条才写：
//   1. 所属条目还在“进行中”（已丢弃、顺延、失败的条目，它的改动一律不写；拒过的网址除外）；
//   2. 过得了主库的字段校验；
//   3. 没有和人工修改冲突：修改时，主库这一行的版本号要和模块读取时一样，不一样说明流程开始后有人改过，跳过不覆盖。
// 出了预料之外的错就整个撤回，主库保持原样。每条改动的结果写回小数据库，当晚报告从这里生成。
const 模块名 = '06-ingest';
const 校验类错误 = new Set(['校验不通过', '指向的记录不存在', '已存在', '请求有误']);

export function 写入主库({ 小数据库, 主库, log, 试跑 = false }) {
  const pending = 小数据库.changes().filter(c => c.result === '待提交');
  const decisions = [];
  for (const c of pending) {
    const item = c.item_key ? 小数据库.item(c.item_key) : null;
    if (c.tbl === 'rejected_url') decisions.push([c, '准备写入', '']);
    else if (c.item_key && !item) decisions.push([c, '不提交', `找不到所属条目 ${c.item_key}`]);
    else if (item && item.status !== '进行中') decisions.push([c, '不提交', `所属条目已${item.status}`]);
    else decisions.push([c, '准备写入', '']);
  }
  const toWrite = decisions.filter(([, result]) => result === '准备写入').map(([c]) => c);
  const summary = { total: pending.length, written: 0, conflicts: 0, rejected: decisions.length - toWrite.length, dryRun: 试跑, error: null };

  if (试跑) {
    log.info(`试跑：不写主库。可以写入 ${toWrite.length} 条，不提交 ${summary.rejected} 条`);
    return { ...summary, wouldWrite: toWrite.length };
  }

  // 一条候选一组（拒过的网址、不挂条目的各自一组）
  const 组们 = new Map();
  for (const c of toWrite) {
    const k = c.tbl === 'rejected_url' || !c.item_key ? `#${c.id}` : c.item_key;
    if (!组们.has(k)) 组们.set(k, []);
    组们.get(k).push(c);
  }
  const outcome = new Map();
  const 丢弃 = [];
  try {
    主库.transaction(tx => {
      // 同一晚对同一行的多次改动：按提出的先后依次应用；冲突检查一律对照流程开始时的版本号
      const touched = new Map();
      for (const [组, 改动们] of 组们) {
        const 这组 = new Map();
        let 写了 = 0;
        try {
          tx.transaction(t => {
            for (const c of 改动们) {
              const id = `${c.tbl}/${c.row_key}`;
              const current = t.get(c.tbl, c.row_key);
              const seen = touched.get(id);
              if (c.op === 'insert') {
                if (current && !seen) { 这组.set(c.id, ['跳过', '主库已有这一行']); continue; }
                if (current) t.update(c.tbl, c.row_key, c.payload, current.version);
                else t.insert(c.tbl, c.row_key, c.payload);
                if (!seen) touched.set(id, { originalVersion: current?.version ?? null });
              } else {
                if (!current) { 这组.set(c.id, ['跳过', '主库没有这一行']); continue; }
                const expected = seen ? seen.originalVersion : current.version;
                if (c.base_version !== expected) { 这组.set(c.id, ['跳过', '流程开始后这一行被改过（版本号不一致），不覆盖']); continue; }
                t.update(c.tbl, c.row_key, c.payload, current.version);
                if (!seen) touched.set(id, { originalVersion: current.version });
              }
              这组.set(c.id, ['已写入', '']);
              写了 += 1;
            }
          });
        } catch (error) {
          if (!校验类错误.has(error?.kind)) throw error;
          const 原因 = `06 入库·写入主库：字段不合格：${String(error.message).slice(0, 200)}`;
          for (const c of 改动们) outcome.set(c.id, ['不提交', 原因]);
          summary.rejected += 改动们.length;
          if (!组.startsWith('#')) 丢弃.push({ key: 组, 原因 });
          continue;
        }
        for (const [id, r] of 这组) outcome.set(id, r);
        summary.written += 写了;
        summary.conflicts += [...这组.values()].filter(([r]) => r === '跳过').length;
      }
    });
  } catch (error) {
    summary.error = String(error?.message || error);
    summary.written = 0;
    summary.conflicts = 0;
    log.error(`写入主库失败，主库已撤回到写之前：${summary.error}`);
    outcome.clear();
    丢弃.length = 0;
    for (const c of toWrite) outcome.set(c.id, ['未写入', `写入失败已撤回：${summary.error}`]);
  }

  小数据库.db.transaction(() => {
    for (const [c, result, reason] of decisions) if (result === '不提交') 小数据库.markChange(c.id, result, reason);
    for (const [id, [result, reason]] of outcome) 小数据库.markChange(id, result, reason);
  })();
  const 还在进行 = 丢弃.filter(d => 小数据库.item(d.key)?.status === '进行中');
  if (还在进行.length) 小数据库.删除(模块名, 还在进行);
  log.info(`写入主库：写入 ${summary.written} 条，冲突跳过 ${summary.conflicts} 条，不提交 ${summary.rejected} 条${summary.error ? '（写入失败）' : ''}`);
  return summary;
}
