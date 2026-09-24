// 报名已截止的赛事定期归档：从公开缓存里撤下（学生端看不到），但记录本身
// 保留在库里（不是删除），方便下一届开始报名时对照旧届次信息。
//
// "下一届大概什么时候开始报名"目前没有可靠信息源——爬虫/AI审核要等官方发了
// 通知才会发现下一届。这里只做最朴素的估算：按上一届的报名开始时间（或比赛
// 开始时间）往后推一年，纯粹给管理员一个大致参考，不是承诺，字段名和口径
// 都要体现这一点。
const DAY_MS = 24 * 60 * 60 * 1000;
const NEXT_EDITION_OFFSET_MS = 365 * DAY_MS;

function estimateNextEditionStart(record) {
  const base = record?.schedule?.registration_start || record?.schedule?.competition_start;
  if (!base) return null;
  const date = new Date(base);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + NEXT_EDITION_OFFSET_MS).toISOString();
}

function shouldArchive(record, registrationStatus, now = new Date()) {
  if (!record || record.dataStatus !== 'published') return false;
  return registrationStatus(record, now) === '已截止';
}

function archiveRecord(record, now = new Date()) {
  return {
    ...record,
    dataStatus: 'archived',
    archivedAt: now.toISOString(),
    archivedReason: 'registration_closed',
    nextEditionEstimate: estimateNextEditionStart(record),
    updatedAt: now.toISOString(),
    updatedBy: 'archive-schedule',
  };
}

module.exports = { estimateNextEditionStart, shouldArchive, archiveRecord };
