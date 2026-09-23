// 2026-09-23 · 批次5：中国研究生创新实践系列大赛（cpipc.acge.org.cn）
//
// 信源性质：教育部学位与研究生教育发展中心主办的官方赛事平台，每个主题赛事
// 有自己的赛事主页，页面直接写明当届届次、参赛对象与参赛方式——是「赛事本身」，
// 不是目录。这正是批次1/4（辽宁实施方案）那条被验证有效的路子。
//
// 其中多项由企业冠名赞助（华为杯创“芯”大赛、网络安全创新大赛等），属于用户
// 要的「企业级」赛事，但主办方是学位中心，权威性和资料完整度都比纯商业赛事高。
//
// 数据纪律：
//   - 参赛对象一律抄官网原文，不概括、不推断。研究生赛事的资格表述往往很细
//     （本研贯通、已获录取资格的本科生、留学生、能否当队长），这些限制直接
//     影响学生能不能报名，不能压缩掉
//   - 报名时间：平台主页只挂通知列表，各赛事报名起止不在主页统一呈现，
//     一律留空并标注待补，不从通知标题日期反推
//   - 费用：官网未统一说明，一律「暂未公布」
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { candidateToRecord } = require('./cjs/candidateToRecord.js');
const { classifyCompetitionScope } = require('./cjs/competitionScope.js');
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const api = 'http://127.0.0.1:8787/api/adminData';
const now = new Date().toISOString();
const RULE_VERSION = 'cpipc-event-page-v1';
const BASE = 'https://cpipc.acge.org.cn/';

const args = process.argv.slice(2);
const get = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const from = Number(get('--from')) || 1;
const to = Number(get('--to')) || 25;
const dryRun = args.includes('--dry-run');
const BATCH_TAG = `curation200-cpipc-${from}-${to}-20260923`;

async function call(body) {
  const response = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: token, ...body }) });
  const result = await response.json();
  if (!result.ok) throw new Error(result.message || 'adminData_failed');
  return result.data;
}

const entries = JSON.parse(fs.readFileSync(new URL('./curation-200-batch5-entries.json', import.meta.url)));

function toRecord(entry) {
  const url = BASE + entry.path;
  const record = candidateToRecord({ externalId: entry.key, name: entry.name, detailUrl: url, tags: [] }, null, { now: new Date(now) });
  record.organizer = '教育部学位与研究生教育发展中心（中国研究生创新实践系列大赛）';
  record.eventLevel = '国家级';
  record.professions = entry.professions;
  record.participants = entry.eligibility;
  record.eligibility = entry.eligibility;
  record.formatAndRules = entry.formatAndRules;
  record.teamSize = entry.teamSize;
  record.teamSizeCategory = entry.teamSizeCategory;
  record.participationFormat = entry.participationFormat;
  record.registrationMethod = '通过中国研究生创新实践系列大赛管理平台注册并报名，具体报名起止时间以该赛事当届通知为准。';
  record.registrationOrganization = '学生个人或团队报名';
  // 赛事主页即官方报名入口（页面含「我要报名」与注册登录入口）
  record.registrationUrl = url;
  record.feeType = '暂未公布';
  record.fees = '';
  record.rewardHighlights = ['国家级竞赛证书'];
  record.rewards = '按当届赛事通知评定等级奖项。';
  record.rewardAmount = null;
  record.rewardTier = '暂未公布';
  record.schedule = { ...record.schedule, registration_start: null, registration_end: null, pending_announcement: true };
  record.firstSeenAt = now;
  record.admissionVerdict = 'admit';
  record.qualityIssues = [
    '报名起止时间待补：平台赛事主页未统一呈现当届报名起止，需查该赛事当届通知',
    '报名费信息未在赛事主页说明',
  ];
  record.track.name = entry.name;
  record.recommendation.recommendation = '信息不足';
  record.recommendation.missing_information = record.qualityIssues;
  record.curationBatch = BATCH_TAG;
  record.ruleVersion = RULE_VERSION;
  record.verifiedBy = 'claude-curation-20260923';
  record.sources = [{
    id: `source-${entry.key}-event`, edition_id: record.id, url, final_url: url,
    source_type: 'organizer_website', is_official: true, validity_status: 'valid',
    published_at: null, last_verified_at: now,
    evidence_excerpt: `${entry.name}｜参赛对象：${entry.eligibility}`.slice(0, 300),
  }];
  return record;
}

const selected = entries.slice(from - 1, to);
if (!selected.length) { console.log('区间内无条目'); process.exit(0); }
if (selected.length > 25) throw new Error(`单批超过25条：${selected.length}`);

const records = selected.map(toRecord);
const blocked = records.map(r => ({ r, s: classifyCompetitionScope(r) })).filter(x => x.s.decision !== 'eligible');
if (blocked.length) {
  console.log(JSON.stringify({ blocked: blocked.map(x => ({ name: x.r.name, reason: x.s.reason })) }, null, 2));
  throw new Error(`${blocked.length} 条未通过范围闸`);
}

const state = await call({ action: 'bootstrap' });
const existing = state.records;
if (!Array.isArray(existing) || !existing.length) throw new Error('拒绝覆盖空库');
const additions = records.filter(record => !existing.some(old => old.id === record.id || old.name === record.name));
if (!additions.length) { console.log('无新增记录'); process.exit(0); }

if (dryRun) { console.log(JSON.stringify({ dryRun: true, wouldAdd: additions.length, names: additions.map(x => x.name) }, null, 2)); process.exit(0); }

const result = await call({
  action: 'saveRecords', records: [...existing, ...additions], expectedVersion: state.stateVersions.records,
  auditEntry: {
    id: `${BATCH_TAG}-${Date.now()}`, action: 'create', objectType: 'event_edition', recordId: 'batch',
    recordName: `中国研究生创新实践系列大赛新增 ${additions.length} 条草稿`,
    changedFields: ['dataStatus'], actor: 'super_admin',
    reason: '逐条读取各赛事在官方平台的赛事主页，核实当届届次与参赛对象原文后写入；报名时间与费用未在主页公布，留空并标注待补', createdAt: now,
  },
});
console.log(JSON.stringify({ batch: BATCH_TAG, added: additions.length, names: additions.map(x => x.name), version: result.version }, null, 2));
