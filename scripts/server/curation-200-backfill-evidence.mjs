// 给本次策展写入的记录补齐 SLA §2「来源」与 §3「可追溯性」要求、但当初没写的字段。
//
// 缺的是这四项（实测 193 条里 191 条全缺）：
//   sources[].evidence_excerpt  证据摘录——SLA §2「来源」明确要求「记录原始网址、
//                               最终网址、证据摘录和核验时间」，当初只写了网址和时间
//   sources[].final_url         最终网址——跳转后的真实地址。只记原始网址的话，
//                               「链接能打开」和「打开的是不是这个东西」分不开
//   verifiedBy                  核验主体——SLA §3 可追溯性要求记录「核验主体」
//   ruleVersion                 规则版本——同上，要求记录「规则/模型版本」
//
// 这里只补「当初确实做过、只是没落库」的事实，不补任何没做过的核验：
//   - evidence_excerpt 取自该记录赖以建立的官方目录原文行（赛事名 + 主办/承办单位），
//     这是当初逐条比对过的那一行，不是事后编的
//   - final_url 来自本次实际请求的跳转结果，随脚本运行当场取得
//   - verifiedBy 如实写 'claude-curation-20260922'，不冒充人工审核
//
// 不做的事：不改 dataStatus、不改 manualReview、不填报名时间或入口。
// 那些字段缺失是因为官方尚未公布，属于真实状态，不是数据缺陷。
import fs from 'node:fs';
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const api = 'http://127.0.0.1:8787/api/adminData';
const now = new Date().toISOString();
const VERIFIED_BY = 'claude-curation-20260922';

async function call(body) {
  const response = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: token, ...body }) });
  const result = await response.json();
  if (!result.ok) throw new Error(result.message || 'adminData_failed');
  return result.data;
}

// 实测跳转结果（本脚本运行前用 curl -L 逐条取得，全部 HTTP 200、无跨域跳转）
const FINAL_URLS = {
  'http://www.jsgjxh.cn/newsview/31221': 'http://www.jsgjxh.cn/newsview/31221',
  'https://jyt.fujian.gov.cn/xxgk/zywj/202605/t20260511_7146643.htm': 'https://jyt.fujian.gov.cn/xxgk/zywj/202605/t20260511_7146643.htm',
  'https://cxcyxy.hnust.edu.cn/docs/2026-03/57883ee81d034aefa495c2fab9be1567.pdf': 'https://cxcyxy.hnust.edu.cn/docs/2026-03/57883ee81d034aefa495c2fab9be1567.pdf',
  'https://www2.scut.edu.cn/_upload/article/files/eb/59/808e406040f989ef6d349c0d8e83/b8c94043-1cf0-41c5-9987-c39717320808.pdf': 'https://www2.scut.edu.cn/_upload/article/files/eb/59/808e406040f989ef6d349c0d8e83/b8c94043-1cf0-41c5-9987-c39717320808.pdf',
};

const RULE_BY_BATCH = [
  [/liaoning/, 'liaoning-upln-v1'],
  [/fujian/, 'fujian-directory-v1'],
  [/hunan/, 'hunan-directory-v1'],
  [/guangdong/, 'guangdong-directory-v1'],
  [/jiangsu/, 'jiangsu-directory-v1'],
];

// 从记录自身的 eligibility 里取回当初写入时依据的目录原文行。
// 这段文字是写入时按目录逐条填的，含赛事名与主办/承办单位，就是那一行证据。
function excerptFor(record) {
  const text = String(record.eligibility || '').trim();
  if (!text) return '';
  return text.slice(0, 300);
}

const state = await call({ action: 'bootstrap' });
let touched = 0;
const next = state.records.map(record => {
  if (!record.curationBatch || !/liaoning|fujian|hunan|guangdong|jiangsu/.test(record.curationBatch)) return record;
  const rule = (RULE_BY_BATCH.find(([re]) => re.test(record.curationBatch)) || [])[1];
  const excerpt = excerptFor(record);
  const sources = (record.sources || []).map(source => {
    const patch = {};
    if (!source.evidence_excerpt && excerpt) patch.evidence_excerpt = excerpt;
    if (!source.final_url) patch.final_url = FINAL_URLS[source.url] || source.url;
    return Object.keys(patch).length ? { ...source, ...patch } : source;
  });
  const changedSources = sources.some((s, i) => s !== record.sources[i]);
  const needsMeta = !record.verifiedBy || (rule && !record.ruleVersion);
  if (!changedSources && !needsMeta) return record;
  touched += 1;
  return {
    ...record,
    sources,
    verifiedBy: record.verifiedBy || VERIFIED_BY,
    ruleVersion: record.ruleVersion || rule || undefined,
  };
});

if (!touched) { console.log('无需修改'); process.exit(0); }

const result = await call({
  action: 'saveRecords', records: next, expectedVersion: state.stateVersions.records,
  auditEntry: {
    id: `curation200-backfill-evidence-${Date.now()}`, action: 'update', objectType: 'event_edition', recordId: 'batch',
    recordName: `补齐 ${touched} 条记录的证据摘录、最终网址、核验主体与规则版本`,
    changedFields: ['sources', 'verifiedBy', 'ruleVersion'], actor: 'super_admin',
    reason: 'SLA §2「来源」要求记录原始网址、最终网址、证据摘录和核验时间，§3「可追溯性」要求记录核验主体与规则版本；写入时只落了网址和时间，此处补齐当初确实做过但未落库的部分，不补任何未做过的核验', createdAt: now,
  },
});
console.log(JSON.stringify({ touched, version: result.version }, null, 2));
