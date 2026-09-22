// 2026-09-22 · 批次2/3：福建省教育厅省级大学生学科专业竞赛项目
//
// 唯一信源：福建省教育厅 闽教高〔2026〕7号《关于公布2026年省级大学生学科专业
// 竞赛项目的通知》及其附件《福建省2026年大学生学科专业竞赛项目目录》。
// https://jyt.fujian.gov.cn/xxgk/zywj/202605/t20260511_7146643.htm
//
// 这份文件是省级教育行政部门的正式发文，能确立的事实：
//   - 赛事当届名称（文件标题写明"2026年"，条目名称含届次）
//   - 主办方（福建省教育厅立项）与承办单位（目录逐条列明）
//   - 大学生属性（文件名即"大学生学科专业竞赛项目"）
//   - 专业内容（赛事名称指向的学科任务）
//
// 它【不能】确立的：报名起止时间、报名入口、赛制细节、费用。
// 这些一律留空并写进 qualityIssues，不推断、不编造。按目录正文要求，
// 承办高校需"于赛事开始前30日将竞赛通知、奖项设置、证书模板等材料报送
// 教育厅审核同意后公布"，即这些信息由承办单位后续单独发布。
//
// 用法：node curation-200-batch-fujian.mjs --from 1 --to 25
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { candidateToRecord } = require('./cjs/candidateToRecord.js');
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const api = 'http://127.0.0.1:8787/api/adminData';
const now = new Date().toISOString();
const NOTICE_URL = 'https://jyt.fujian.gov.cn/xxgk/zywj/202605/t20260511_7146643.htm';
const RULE_VERSION = 'fujian-directory-v1';

const args = process.argv.slice(2);
const from = Number(args[args.indexOf('--from') + 1]) || 0;
const to = Number(args[args.indexOf('--to') + 1]) || 25;
const BATCH_TAG = `curation200-fujian-${from}-${to}-20260922`;

async function call(body) {
  const response = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: token, ...body }) });
  const result = await response.json();
  if (!result.ok) throw new Error(result.message || 'adminData_failed');
  return result.data;
}

const list = JSON.parse(fs.readFileSync(new URL('./curation-200-fujian-list.json', import.meta.url)));
const professions = JSON.parse(fs.readFileSync(new URL('./curation-200-fujian-professions.json', import.meta.url)));
// 目录里这几条已在库内有对应记录（全国赛本体或同名记录），不重复写入。
const SKIP = new Set(['6', '13', '14', '28', '59']);

function toRecord(item) {
  const key = `fujian-${item.code.toLowerCase()}`;
  const candidate = { externalId: key, name: item.name, detailUrl: NOTICE_URL, tags: [] };
  const record = candidateToRecord(candidate, null, { now: new Date(now) });
  const eligibility = `福建省普通高等学校在校学生。依据福建省教育厅闽教高〔2026〕7号《福建省2026年大学生学科专业竞赛项目目录》，本赛事为2026年福建省省级大学生学科专业竞赛项目（竞赛编号${item.code}），承办单位${item.org}。`;
  record.organizer = `福建省教育厅（立项）／${item.org}（承办）`;
  record.eventLevel = '省级';
  record.professions = professions[item.no] || [];
  record.participants = eligibility;
  record.eligibility = eligibility;
  record.formatAndRules = `2026年福建省省级大学生学科专业竞赛项目，竞赛编号${item.code}，由${item.org}承办。按目录通知要求，承办单位须在赛事开始前30日将竞赛通知、奖项设置与证书模板报福建省教育厅审核同意后公布，具体赛制、评审办法与奖项设置以承办单位届时发布的竞赛通知为准。`;
  record.teamSize = '暂未公布';
  record.teamSizeCategory = '暂未明确';
  record.participationFormat = '暂未明确';
  record.registrationMethod = '';
  record.registrationOrganization = '暂未公布';
  // 目录文件是立项依据，不是报名入口。SLA 明确"新闻链接不得充当报名入口"，
  // 同理目录也不能——留空，等承办单位发布竞赛通知后补。
  record.registrationUrl = '';
  record.feeType = '暂未公布';
  record.fees = '';
  record.rewardHighlights = [];
  record.rewards = '';
  record.rewardAmount = null;
  record.rewardTier = '暂未公布';
  record.schedule = { ...record.schedule, registration_start: null, registration_end: null, pending_announcement: true };
  record.firstSeenAt = now;
  record.admissionVerdict = 'review';
  record.qualityIssues = [
    '报名起止时间未公布：目录为立项文件，赛事时间由承办单位另行发布',
    '报名入口待补：目录文件不能充当报名入口',
    '赛制、奖项与费用待承办单位发布竞赛通知后补齐',
    `需向承办单位（${item.org}）核实当届竞赛通知`,
  ];
  record.track.name = item.name;
  record.recommendation.recommendation = '信息不足';
  record.recommendation.missing_information = record.qualityIssues;
  record.curationBatch = BATCH_TAG;
  record.ruleVersion = RULE_VERSION;
  record.sources = [{
    id: `source-${key}-directory`,
    edition_id: record.id,
    url: NOTICE_URL,
    source_type: 'authority_notice',
    is_official: true,
    validity_status: 'valid',
    published_at: '2026-05-11',
    last_verified_at: now,
  }];
  return record;
}

const selected = list.filter(item => !SKIP.has(item.no)).slice(from - 1, to);
if (!selected.length) { console.log('区间内无条目'); process.exit(0); }
if (selected.length > 25) throw new Error(`单批超过25条：${selected.length}`);

const state = await call({ action: 'bootstrap' });
const existing = state.records;
if (!Array.isArray(existing) || !existing.length) throw new Error('拒绝覆盖空库');
const additions = selected.map(toRecord).filter(record => !existing.some(old => old.id === record.id || old.name === record.name));
if (!additions.length) { console.log('无新增记录'); process.exit(0); }

const result = await call({
  action: 'saveRecords', records: [...existing, ...additions], expectedVersion: state.stateVersions.records,
  auditEntry: {
    id: `${BATCH_TAG}-${Date.now()}`, action: 'create', objectType: 'event_edition', recordId: 'batch',
    recordName: `福建省教育厅省级竞赛目录新增 ${additions.length} 条赛事草稿`,
    changedFields: ['dataStatus'], actor: 'super_admin',
    reason: '依据福建省教育厅闽教高〔2026〕7号省级大学生学科专业竞赛项目目录立项文件写入草稿；时间、入口、赛制均未公布，已逐条标注待补', createdAt: now,
  },
});
console.log(JSON.stringify({ batch: BATCH_TAG, added: additions.length, names: additions.map(x => x.name), version: result.version }, null, 2));
