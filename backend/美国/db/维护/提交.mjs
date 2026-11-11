// 提交：审计和处理都做完后，把改动用一个事务写进比赛库。
//
//   新增（insert）：库里已经有这一行的，跳过
//   修改（update）：payload 只写要改的字段（比赛库会合并到原记录）；
//                   库里这一行的版本号要和处理时读到的（baseVersion）一样，不一样说明期间有人改过，跳过不覆盖
//   放回收站（trash）：标记删除，版本号同样要对得上；带理由的把理由加进届次的 status_reason，后台回收站显示
// 事务中途出错就整个撤回，比赛库保持原样。试跑只统计，不写。
export function commitChanges({ db, changes, log, dryRun = false }) {
  const summary = { total: changes.length, written: 0, skipped: [], dryRun, error: null };
  if (dryRun) {
    log.info(`试跑：不写比赛库。一共要改 ${changes.length} 条`);
    return summary;
  }
  const skip = (c, reason) => summary.skipped.push({ table: c.table, key: c.key, reason });
  try {
    db.transaction(tx => {
      for (const c of changes) {
        const current = tx.get(c.table, c.key);
        if (c.op === 'insert') {
          if (current) { skip(c, '比赛库已有这一行'); continue; }
          tx.insert(c.table, c.key, c.payload);
        } else if (c.op === 'update') {
          if (!current) { skip(c, '比赛库没有这一行'); continue; }
          if (current.version !== c.baseVersion) { skip(c, '读取之后这一行被改过（版本号不一致），不覆盖'); continue; }
          tx.update(c.table, c.key, c.payload, current.version);
        } else if (c.op === 'trash') {
          if (!current) { skip(c, '比赛库没有这一行'); continue; }
          if (current.version !== c.baseVersion) { skip(c, '读取之后这一行被改过（版本号不一致），不覆盖'); continue; }
          if (c.理由) tx.update(c.table, c.key, { status_reason: [...(current.data.status_reason || []), c.理由] }, current.version);
          tx.标记删除(c.table, c.key, { by: c.by, at: c.at });
        } else {
          skip(c, `不认识的操作 ${c.op}`);
          continue;
        }
        summary.written += 1;
      }
    });
  } catch (error) {
    summary.error = String(error?.message || error);
    summary.written = 0;
    summary.skipped = [];
    log.error(`提交失败，比赛库已撤回到提交前：${summary.error}`);
    return summary;
  }
  log.info(`提交：写入 ${summary.written} 条，跳过 ${summary.skipped.length} 条`);
  return summary;
}
