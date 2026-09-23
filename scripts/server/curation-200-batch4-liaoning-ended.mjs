// 2026-09-23 · 批次4：辽宁省大学生创新创业管理共享平台「2026年已结束」赛事
//
// 为什么回头做这一批：
// 前几批拿省级立项目录批量入库，被 AI 身份审核大面积隔离，理由完全正确——
// 「来源系省教育厅公布竞赛项目目录的通知，非该赛事当届通知或比赛记录」。
// 用户最初的要求原文就是「通知和目录只提供线索，逐项找到比赛本身」，SLA §1
// 也把目录归入线索区、明确不计入新增量。辽宁这批之所以一条没被隔离，是因为
// 每条都有该赛事自己的当届实施方案正文。
//
// 所以这批回到同一个已验证信源：cxcy.upln.cn 的 detail 接口，每条都有完整
// 实施方案（正文 1300–6000 字），逐条读出参赛对象、赛制、费用后写入。
// 当初只取了「进行中」「未开始」，没取「已结束」——用户后来明确报名状态不限。
//
// 数据纪律：
//   - id 与 name 全部来自官方列表，写入前逐条校验 id 存在且名称完全一致
//     （初稿曾把 id 写成臆造的十六进制串，会生成指向不存在赛事的来源 URL，
//      已用官方列表回填并全量校验）
//   - 费用只在实施方案明确写了才填：本批 6 条明确免费、1 条明确 80 元/人，
//     其余一律「暂未公布」，不推断
//   - 报名状态按官方时间如实计算，已截止就是已截止，不改写时间蒙混
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { candidateToRecord } = require('./cjs/candidateToRecord.js');
const { classifyCompetitionScope } = require('./cjs/competitionScope.js');
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const api = 'http://127.0.0.1:8787/api/adminData';
const now = new Date().toISOString();
const RULE_VERSION = 'liaoning-upln-detail-v1';

const args = process.argv.slice(2);
const get = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const from = Number(get('--from')) || 1;
const to = Number(get('--to')) || 25;
const dryRun = args.includes('--dry-run');
const BATCH_TAG = `curation200-liaoning-ended-${from}-${to}-20260923`;

async function call(body) {
  const response = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: token, ...body }) });
  const result = await response.json();
  if (!result.ok) throw new Error(result.message || 'adminData_failed');
  return result.data;
}

const entries = JSON.parse(fs.readFileSync(new URL('./curation-200-batch4-entries.json', import.meta.url)));

function toRecord(entry) {
  const detailUrl = `https://cxcy.upln.cn/provincial/match/competition/detail?id=${entry.id}`;
  const record = candidateToRecord(
    { externalId: entry.key, name: entry.name, detailUrl, tags: [], registration_start: entry.start, registration_end: entry.end },
    null, { now: new Date(now) },
  );
  record.organizer = `辽宁省教育厅（承办：${entry.undertake}）`;
  record.eventLevel = '省级';
  record.professions = entry.professions;
  record.participants = entry.eligibility;
  record.eligibility = entry.eligibility;
  record.formatAndRules = entry.formatAndRules;
  record.teamSize = entry.teamSize;
  record.teamSizeCategory = entry.teamSizeCategory;
  record.participationFormat = entry.participationFormat;
  record.registrationMethod = `通过辽宁省大学生创新创业管理共享平台报名，报名时间 ${entry.start.slice(0, 10)} 至 ${entry.end.slice(0, 10)}。`;
  record.registrationOrganization = entry.registrationOrganization;
  record.registrationUrl = detailUrl;
  record.feeType = entry.feeType;
  record.fees = entry.fees;
  record.rewardHighlights = ['省级竞赛证书'];
  record.rewards = '按实施方案评定名次奖项。';
  record.rewardAmount = null;
  record.rewardTier = '暂未公布';
  record.schedule = { ...record.schedule, registration_start: entry.start, registration_end: entry.end, pending_announcement: false };
  record.firstSeenAt = now;
  record.admissionVerdict = 'admit';
  record.qualityIssues = entry.issues || [];
  record.track.name = entry.name;
  record.recommendation.recommendation = '信息不足';
  record.recommendation.missing_information = entry.issues || [];
  record.curationBatch = BATCH_TAG;
  record.ruleVersion = RULE_VERSION;
  record.verifiedBy = 'claude-curation-20260923';
  record.sources = [{
    id: `source-${entry.key}-scheme`, edition_id: record.id, url: detailUrl, final_url: detailUrl,
    source_type: 'organizer_notice', is_official: true, validity_status: 'valid',
    published_at: null, last_verified_at: now,
    evidence_excerpt: `${entry.name}｜承办：${entry.undertake}｜参赛对象：${entry.eligibility}`.slice(0, 300),
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

if (dryRun) {
  console.log(JSON.stringify({ dryRun: true, wouldAdd: additions.length, names: additions.map(x => x.name) }, null, 2));
  process.exit(0);
}

const result = await call({
  action: 'saveRecords', records: [...existing, ...additions], expectedVersion: state.stateVersions.records,
  auditEntry: {
    id: `${BATCH_TAG}-${Date.now()}`, action: 'create', objectType: 'event_edition', recordId: 'batch',
    recordName: `辽宁官方平台已结束赛事新增 ${additions.length} 条草稿`,
    changedFields: ['dataStatus'], actor: 'super_admin',
    reason: '逐条读取 cxcy.upln.cn 该赛事当届实施方案正文，核实参赛对象、赛制、时间与费用后写入；不使用目录类来源', createdAt: now,
  },
});
console.log(JSON.stringify({ batch: BATCH_TAG, added: additions.length, names: additions.map(x => x.name), version: result.version }, null, 2));
