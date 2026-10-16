// 自动任务（AI 审核、字段周检、到期归档、草稿超时检查）写库前后逐条比对，
// 关键字段有变化就生成一条审计，后台“操作日志”能看到谁在什么时候、为什么改了哪条。
// 只比对关键字段：AI 每次刷新审核意见本身不记，否则一天几百条，会把真正的改动淹没。
// 2026-09-29 起加：此前自动任务直接写库不留痕，一轮周审撤下 24 条已发布赛事却无从追查。

const SYSTEM_ACTORS = Object.freeze({
  'ai-review':'AI审核（自动）',
  'field-verification':'字段周检（自动）',
  'archive-job':'到期归档（自动）',
  'stale-draft-check':'草稿超时检查（自动）',
});

const STATUS_LABELS = {
  published:'已发布', archived:'已归档', quarantined:'隔离', draft:'草稿', offline:'已下架', reviewing:'审核中',
  pending_manual_review:'待人工审核', pending_system_validation:'待系统校验',
};

const TRACKED = [
  ['dataStatus', '状态', record => record.dataStatus],
  ['name', '名称', record => record.name],
  ['registration_start', '报名开始', record => record.schedule?.registration_start],
  ['registration_end', '报名截止', record => record.schedule?.registration_end],
  ['registrationUrl', '报名链接', record => record.registrationUrl],
  ['needsManualReview', '需人工核对', record => Boolean(record.needsManualReview)],
];

const show = (field, value) => {
  if (value === undefined || value === null || value === '') return '空';
  if (field === 'dataStatus') return STATUS_LABELS[value] || value;
  if (field.startsWith('registration_') && field !== 'registrationUrl') return String(value).slice(0, 10);
  if (field === 'needsManualReview') return value ? '是' : '否';
  return `「${String(value).slice(0, 80)}」`;
};

// 这次变化的原因：隔离写隔离理由，归档写截止日，打标记写最新一条问题。
function whyChanged(before, after) {
  if (after.dataStatus === 'quarantined' && before.dataStatus !== 'quarantined') return after.quarantine?.reason || '';
  if (after.dataStatus === 'archived' && before.dataStatus !== 'archived') return `报名截止 ${show('registration_end', after.schedule?.registration_end)} 已过`;
  if (after.needsManualReview && !before.needsManualReview) {
    const added = (after.qualityIssues || []).filter(item => !(before.qualityIssues || []).includes(item));
    return String(added[added.length - 1] || after.staleDraftReason || after.fieldVerification?.summary || '');
  }
  return '';
}

function autoAudits(beforeRecords, afterRecords, actor, now = new Date(), reasons = new Map()) {
  if (!SYSTEM_ACTORS[actor]) throw new Error(`unknown_system_actor:${actor}`);
  const byId = new Map((beforeRecords || []).map(record => [record.id, record]));
  const stamp = now.getTime();
  const entries = [];
  for (const after of afterRecords || []) {
    const before = byId.get(after.id);
    if (!before) continue;
    const changes = {};
    const parts = [];
    for (const [field, label, read] of TRACKED) {
      const from = read(before), to = read(after);
      if (from === to || (from == null && to == null)) continue;
      changes[field] = { before:from ?? null, after:to ?? null };
      parts.push(`${label} ${show(field, from)} → ${show(field, to)}`);
    }
    if (!parts.length && !reasons.has(after.id)) continue;
    if (!parts.length) parts.push('Kimi 代理已完成补查，保留当前状态');
    const why = reasons.get(after.id) || whyChanged(before, after);
    entries.push({
      id:`auto-${actor}-${stamp}-${entries.length}`,
      action:after.dataStatus === 'archived' && before.dataStatus !== 'archived' ? 'archive' : 'update',
      objectType:'event_edition',
      recordId:String(after.id).slice(0, 200),
      recordName:after.name || before.name,
      changedFields:Object.keys(changes),
      changes,
      reason:`${parts.join('；')}${why ? `。原因：${why}` : ''}`,
      createdAt:now.toISOString(),
      systemActor:actor,
    });
  }
  const retained = new Set((afterRecords || []).map(record => record.id));
  for (const before of beforeRecords || []) {
    if (retained.has(before.id)) continue;
    entries.push({ id:`auto-${actor}-${stamp}-${entries.length}`, action:'delete', objectType:'event_edition',
      recordId:String(before.id).slice(0, 200), recordName:before.name, changedFields:['dataStatus'],
      changes:{dataStatus:{before:before.dataStatus || null,after:null}},
      reason:reasons.get(before.id) || 'Kimi 代理补查后仍无法核实，已从比赛库删除并保存处置备份',
      createdAt:now.toISOString(), systemActor:actor });
  }
  return entries;
}

module.exports = { SYSTEM_ACTORS, autoAudits };
