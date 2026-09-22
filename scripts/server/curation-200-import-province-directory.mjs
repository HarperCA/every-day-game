// 省级教育行政部门「学科竞赛立项目录」通用导入器。
//
// 这类文件各省格式统一：一份正式发文 + 一张「赛事名称 / 承办单位」表。
// 它能确立的事实有限但可靠，不能确立的一律留空——把这条纪律写进代码，
// 而不是每个省复制一份脚本各写各的。
//
// 能确立：当届赛事名称、主办方（省教育厅立项）、承办单位、大学生属性、专业内容
// 不能确立：报名起止时间、报名入口、赛制、奖项、费用、参赛人数
//
// 用法：
//   node curation-200-import-province-directory.mjs --province fujian --from 1 --to 25
//   node curation-200-import-province-directory.mjs --province hunan --from 1 --to 25 --dry-run
//
// 每个省需要三样东西：
//   curation-200-<province>-list.json         [{no, name, org, code?}]
//   curation-200-<province>-professions.json  {no: [专业分类...]}
//   下面 PROVINCES 里的一条配置（官方文件出处、措辞、已存在需跳过的条目）
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { candidateToRecord } = require('./cjs/candidateToRecord.js');
const { classifyCompetitionScope } = require('./cjs/competitionScope.js');
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const api = 'http://127.0.0.1:8787/api/adminData';
const now = new Date().toISOString();

const PROVINCES = {
  fujian: {
    label: '福建省',
    authority: '福建省教育厅',
    docTitle: '闽教高〔2026〕7号《关于公布2026年省级大学生学科专业竞赛项目的通知》附件《福建省2026年大学生学科专业竞赛项目目录》',
    url: 'https://jyt.fujian.gov.cn/xxgk/zywj/202605/t20260511_7146643.htm',
    publishedAt: '2026-05-11',
    ruleVersion: 'fujian-directory-v1',
    // 目录正文要求承办高校赛前30日报送竞赛通知后公布
    releaseNote: '按目录通知要求，承办单位须在赛事开始前30日将竞赛通知、奖项设置与证书模板报福建省教育厅审核同意后公布',
    skip: ['6', '13', '14', '28', '59'],
  },
  jiangsu: {
    label: '江苏省',
    authority: '江苏省高等教育学会（受江苏省教育厅委托）',
    docTitle: '苏高教会〔2026〕21号《关于公布2026年全省普通高校本专科生学科竞赛省级赛事目录的通知》附件1《2026年全省普通高校本专科生学科竞赛省级赛事目录》',
    url: 'http://www.jsgjxh.cn/newsview/31221',
    publishedAt: '2026-06-12',
    ruleVersion: 'jiangsu-directory-v1',
    releaseNote: '按通知，该目录经各赛事申报单位、主办单位及承办单位审核，专家评议审定并社会公示后形成；赛事举办期间学会接受社会监督',
    // 江苏目录列的是「主办单位」而非「承办单位」，措辞需区分
    orgRole: '主办',
    // 目录条目自带层级（上级部门组织赛事／省级赛事认可／省级赛事培育），写进赛制说明
    useTier: true,
    // S10/S14/S15 经范围闸判定不是单场比赛，闸拦对了，不强行放行：
    //   S10「江苏省大学生知识产权赛事」是赛事集合的统称，不是一场具体比赛
    //   S14「江苏省大学生艺术展演」是展演活动
    //   S15「江苏省高校设计作品展」是作品展览
    //   78「优秀短视频作品征集活动」是征集活动，同样不是比赛
    skip: ['S2', 'S3', 'S10', 'S14', 'S15', '12', '22', '23', '26', '30', '37', '41', '46', '47', '54', '64', '65', '66', '78'],
  },
  guangdong: {
    label: '广东省',
    authority: '广东省教育厅',
    docTitle: '《关于做好2025年广东省本科高校大学生学科竞赛工作的通知》附件《2025年广东省本科高校大学生学科竞赛承办单位及联系方式》（依据《广东省教育厅关于公布2025-2026年广东省本科高校大学生学科竞赛赛项及承办单位的通知》安排）',
    url: 'https://www2.scut.edu.cn/_upload/article/files/eb/59/808e406040f989ef6d349c0d8e83/b8c94043-1cf0-41c5-9987-c39717320808.pdf',
    publishedAt: '2025',
    ruleVersion: 'guangdong-directory-v1',
    releaseNote: '按通知要求，承办单位须在比赛开始前30日将竞赛具体实施方案报广东省教育厅审核，审核后在其官网或赛事网站发布参赛通知（含报名方式及截止日期）',
    skip: ['2', '12'],
  },
  hunan: {
    label: '湖南省',
    authority: '湖南省教育厅',
    docTitle: '湘教通〔2026〕10号《湖南省教育厅关于组织举办2026年全省普通高校大学生学科竞赛的通知》',
    url: 'https://cxcyxy.hnust.edu.cn/docs/2026-03/57883ee81d034aefa495c2fab9be1567.pdf',
    publishedAt: '2026-03',
    ruleVersion: 'hunan-directory-v1',
    releaseNote: '按通知要求，竞赛章程与通知须经湖南省教育厅高教处审定后公布，承办高校须提前15天报送组织实施方案',
    skip: ['16'],
  },
};

function parseArgs() {
  const a = process.argv.slice(2);
  const get = flag => { const i = a.indexOf(flag); return i >= 0 ? a[i + 1] : undefined; };
  return { province: get('--province'), from: Number(get('--from')) || 1, to: Number(get('--to')) || 25, dryRun: a.includes('--dry-run') };
}

async function call(body) {
  const response = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: token, ...body }) });
  const result = await response.json();
  if (!result.ok) throw new Error(result.message || 'adminData_failed');
  return result.data;
}

const args = parseArgs();
const cfg = PROVINCES[args.province];
if (!cfg) throw new Error(`未配置的省份：${args.province}；已配置：${Object.keys(PROVINCES).join('、')}`);
const BATCH_TAG = `curation200-${args.province}-${args.from}-${args.to}-${now.slice(0, 10).replace(/-/g, '')}`;

const list = JSON.parse(fs.readFileSync(new URL(`./curation-200-${args.province}-list.json`, import.meta.url)));
const professions = JSON.parse(fs.readFileSync(new URL(`./curation-200-${args.province}-professions.json`, import.meta.url)));
const skip = new Set(cfg.skip || []);

function toRecord(item) {
  const key = `${args.province}-${item.code ? item.code.toLowerCase() : `no${item.no}`}`;
  const record = candidateToRecord({ externalId: key, name: item.name, detailUrl: cfg.url, tags: [] }, null, { now: new Date(now) });
  const codeNote = item.code ? `（竞赛编号${item.code}）` : '';
  const orgRole = cfg.orgRole || '承办';
  const tierNote = cfg.useTier && item.tier ? `，目录分类为“${item.tier}”` : '';
  const eligibility = `${cfg.label}普通高等学校在校学生。依据${cfg.authority}${cfg.docTitle}，本赛事为2026年${cfg.label}省级大学生学科竞赛项目${codeNote}${tierNote}，${orgRole}单位${item.org}。`;
  record.organizer = `${cfg.authority}（立项）／${item.org}（${orgRole}）`;
  record.eventLevel = '省级';
  record.professions = professions[item.no] || [];
  record.participants = eligibility;
  record.eligibility = eligibility;
  record.formatAndRules = `2026年${cfg.label}省级大学生学科竞赛项目${codeNote}${tierNote}，由${item.org}${orgRole}。${cfg.releaseNote}，具体赛制、评审办法与奖项设置以${orgRole}单位届时发布的竞赛通知为准。`;
  record.teamSize = '暂未公布';
  record.teamSizeCategory = '暂未明确';
  record.participationFormat = '暂未明确';
  record.registrationMethod = '';
  record.registrationOrganization = '暂未公布';
  // 立项目录不是报名入口（SLA §2：新闻链接不得充当报名入口，目录同理）
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
    `需向${orgRole}单位（${item.org}）核实当届竞赛通知`,
  ];
  record.track.name = item.name;
  record.recommendation.recommendation = '信息不足';
  record.recommendation.missing_information = record.qualityIssues;
  record.curationBatch = BATCH_TAG;
  record.ruleVersion = cfg.ruleVersion;
  record.sources = [{
    id: `source-${key}-directory`, edition_id: record.id, url: cfg.url,
    source_type: 'authority_notice', is_official: true, validity_status: 'valid',
    published_at: cfg.publishedAt, last_verified_at: now,
  }];
  return record;
}

const selected = list.filter(item => !skip.has(item.no)).slice(args.from - 1, args.to);
if (!selected.length) { console.log('区间内无条目'); process.exit(0); }
if (selected.length > 25) throw new Error(`单批超过25条：${selected.length}，请缩小 --from/--to 区间`);

// 写库前先过一遍范围闸，避免在服务器上一条条撞错
const records = selected.map(toRecord);
const blocked = records.map(r => ({ r, s: classifyCompetitionScope(r) })).filter(x => x.s.decision !== 'eligible');
if (blocked.length) {
  console.log(JSON.stringify({ blocked: blocked.map(x => ({ name: x.r.name, decision: x.s.decision, reason: x.s.reason })) }, null, 2));
  throw new Error(`${blocked.length} 条未通过范围闸，先处理再写入`);
}

const state = await call({ action: 'bootstrap' });
const existing = state.records;
if (!Array.isArray(existing) || !existing.length) throw new Error('拒绝覆盖空库');
const additions = records.filter(record => !existing.some(old => old.id === record.id || old.name === record.name));
if (!additions.length) { console.log('无新增记录'); process.exit(0); }

if (args.dryRun) {
  console.log(JSON.stringify({ dryRun: true, batch: BATCH_TAG, wouldAdd: additions.length, names: additions.map(x => x.name) }, null, 2));
  process.exit(0);
}

const result = await call({
  action: 'saveRecords', records: [...existing, ...additions], expectedVersion: state.stateVersions.records,
  auditEntry: {
    id: `${BATCH_TAG}-${Date.now()}`, action: 'create', objectType: 'event_edition', recordId: 'batch',
    recordName: `${cfg.authority}立项目录新增 ${additions.length} 条赛事草稿`,
    changedFields: ['dataStatus'], actor: 'super_admin',
    reason: `依据${cfg.authority}${cfg.docTitle}写入草稿；时间、入口、赛制均未公布，已逐条标注待补`, createdAt: now,
  },
});
console.log(JSON.stringify({ batch: BATCH_TAG, added: additions.length, names: additions.map(x => x.name), version: result.version }, null, 2));
