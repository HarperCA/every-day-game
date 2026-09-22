// 清除批次1（辽宁）记录里为通过旧范围闸而补写的关键词，恢复官方实施方案原文。
//
// 背景：旧的 classifyCompetitionScope 用一张学科词表匹配 title+formatAndRules，
// 这三条赛事正文没出现表内的词，被判"缺少专业学习或专业技能关联依据"而拒绝写入。
// 当时的绕过办法是往 formatAndRules 前面加一句"面向XX专业学生的…"，
// 那句话不是官方原文，是为了讨好正则写的。
//
// 范围闸改成"professions 已判定即视为专业关联依据"之后，这三条用原文就能通过
// （tests/competition-scope.test.mjs 有对应断言），补写的词没有存在理由了。
import fs from 'node:fs';
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const api = 'http://127.0.0.1:8787/api/adminData';
const now = new Date().toISOString();

async function call(body) {
  const response = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: token, ...body }) });
  const result = await response.json();
  if (!result.ok) throw new Error(result.message || 'adminData_failed');
  return result.data;
}

// id -> [补写后的文本, 官方原文]
const RESTORE = {
  'edition-liaoning-intercultural-competence-2026': [
    '面向外语专业学生的跨文化交际能力竞赛，由外语教学与研究出版社（外教社）主办，第九届“外教社杯”全国高校学生跨文化能力大赛辽宁赛区比赛，设跨文化能力大赛团队现场赛与短视频赛。',
    '第九届“外教社杯”全国高校学生跨文化能力大赛辽宁赛区比赛，设跨文化能力大赛团队现场赛与短视频赛。',
  ],
  'edition-liaoning-classics-recitation-writing-2026': [
    '面向汉语言文学、语言文字相关专业的经典诵读与讲解竞赛，弘扬中华优秀传统文化，设诵读与讲解两类赛项，提交作品并由专家评审。',
    '弘扬中华优秀传统文化，设诵读与讲解两类赛项，提交作品并由专家评审。',
  ],
  'edition-liaoning-business-comprehensive-ability-2026': [
    '面向经管、商务专业学生的商科综合能力类省级竞赛，具体赛制以附件《2026年第五届辽宁省大学生商科综合能力大赛通知NEW》为准。',
    '商科综合能力类省级竞赛，具体赛制以附件《2026年第五届辽宁省大学生商科综合能力大赛通知NEW》为准。',
  ],
};

const state = await call({ action: 'bootstrap' });
const changed = [];
const next = state.records.map(record => {
  const entry = RESTORE[record.id];
  if (!entry) return record;
  const [padded, original] = entry;
  if (record.formatAndRules !== padded) {
    console.log(`跳过 ${record.id}：当前文本与预期的补写文本不一致，不覆盖`);
    return record;
  }
  changed.push({ id: record.id, name: record.name });
  return { ...record, formatAndRules: original, lastVerifiedAt: now };
});

if (!changed.length) { console.log('无需修改'); process.exit(0); }

const result = await call({
  action: 'saveRecords', records: next, expectedVersion: state.stateVersions.records,
  auditEntry: {
    id: `curation200-batch1-unpad-${Date.now()}`, action: 'update', objectType: 'event_edition', recordId: 'batch',
    recordName: `恢复 ${changed.length} 条记录的官方原文，删除为通过旧范围闸补写的关键词`,
    changedFields: ['formatAndRules'], actor: 'super_admin',
    reason: '旧范围闸用学科词表匹配正文，导致写入方补写词语讨好过滤器；闸改为以 professions 为专业关联依据后，补写内容失去存在理由', createdAt: now,
  },
});
console.log(JSON.stringify({ changed, version: result.version }, null, 2));
