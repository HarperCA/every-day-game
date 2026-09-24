// 只读分层隔离记录，帮助人工逐条复核；不调用 AI、不修改数据库。
import fs from 'node:fs/promises';

const token = (await fs.readFile('/opt/daily-contest/.admin-token', 'utf8')).trim();
const response = await fetch('http://127.0.0.1:8787/api/adminData', {
  method: 'POST',
  headers: {'content-type': 'application/json'},
  body: JSON.stringify({adminToken: token, action: 'bootstrap'}),
});
const result = await response.json();
if (!response.ok || !result.ok) throw new Error(result.message || `HTTP ${response.status}`);

const now = Date.now();
const quarantined = result.data.records.filter(record => record.dataStatus === 'quarantined');
const nonEventPattern = /(通知|公告|公示|目录|清单|名单|获奖|喜报|动态|资讯|速递|新闻|启动|举行|圆满|结果|获.*奖|竞赛分类|大赛动态|国赛公告|通知公告)$/;
const schoolSelectionPattern = /(校赛|校级|校内选拔|校园选拔|院级选拔)/;
const youthPattern = /(中小学生|小学生|初中生|高中生|青少年|少儿|幼儿)/;
const hasOfficialSource = record => (record.sources || []).some(source => source.is_official && /^https?:\/\//.test(source.url || ''));
const hasCore = record => Boolean(record.organizer && record.eligibility && record.formatAndRules && (record.professions || []).length);
const isExpired = record => {
  if (record.schedule?.status_override === '已截止') return true;
  const end = Date.parse(record.schedule?.registration_end || '');
  return Number.isFinite(end) && end < now;
};

const rows = quarantined.map(record => {
  const reasons = [];
  if (nonEventPattern.test(record.name || '')) reasons.push('标题属于通知/新闻/目录等非赛事实体');
  if (schoolSelectionPattern.test(record.name || '')) reasons.push('校赛或校内选拔');
  if (youthPattern.test([record.name, record.eligibility].filter(Boolean).join(' '))) reasons.push('非大学生范围');
  if (isExpired(record)) reasons.push('已过期');
  if (!hasOfficialSource(record)) reasons.push('缺少官方来源');
  if (!hasCore(record)) reasons.push('关键字段不完整');
  const recoverable = reasons.length === 0;
  return {
    id: record.id,
    name: record.name,
    recoverable,
    reasons,
    registrationStart: record.schedule?.registration_start || null,
    registrationEnd: record.schedule?.registration_end || null,
    officialUrls: (record.sources || []).filter(source => source.is_official).map(source => source.url),
    quarantineReason: record.quarantineReason || record.manualReviewReason || record.staleDraftReason || null,
  };
});
const report = {
  generatedAt: new Date().toISOString(),
  version: result.data.stateVersions.records,
  total: quarantined.length,
  recoverableByFields: rows.filter(row => row.recoverable).length,
  rejectedByRules: rows.filter(row => !row.recoverable).length,
  reasonCounts: rows.flatMap(row => row.reasons).reduce((counts, reason) => (counts[reason] = (counts[reason] || 0) + 1, counts), {}),
  recoverableCandidates: rows.filter(row => row.recoverable),
  all: rows,
};
const output = `/opt/daily-contest/reports/quarantine-triage-${Date.now()}.json`;
await fs.mkdir('/opt/daily-contest/reports', {recursive: true});
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({...report, all: undefined, output}, null, 2));
