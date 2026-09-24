// 只读盘点发现到发布的实际结果，不调用模型、不改赛事库。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const token = fs.readFileSync(path.join(here, '.admin-token'), 'utf8').trim();
const response = await fetch('http://127.0.0.1:8787/api/adminData', {
  method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({adminToken:token,action:'bootstrap'}),
});
const payload = await response.json();
if (!payload.ok || !Array.isArray(payload.data?.records)) throw new Error('bootstrap failed');
const records = payload.data.records;
const now = Date.now();
const drafts = records.filter(r => r.dataStatus === 'draft');
const expired = r => Number.isFinite(Date.parse(r.schedule?.registration_end)) && Date.parse(r.schedule.registration_end) < now;
const missing = r => ['organizer','participants','eligibility','formatAndRules'].filter(k => !String(r[k] || '').trim());
const directoryOnly = r => /目录为立项|目录文件不能充当报名入口|目录线索|仅有.*目录/.test((r.qualityIssues || []).join(' '));
const rows = drafts.map(r => ({id:r.id,name:r.name,expired:expired(r),missing:missing(r),
  professions:r.professions,source:r.sources?.[0]?.url,registrationUrl:r.registrationUrl,
  schedule:r.schedule,verdict:r.admissionVerdict,firstSeenAt:r.firstSeenAt,
  sourceStates:r.sources?.map(s=>({url:s.url,official:s.is_official,validity:s.validity_status})),
  verification:r.aiFieldVerification,issues:r.qualityIssues,
  participants:r.participants,eligibility:r.eligibility,formatAndRules:r.formatAndRules,organizer:r.organizer,
}));
const summary = {at:new Date().toISOString(),version:payload.data.stateVersions.records,total:records.length,
  states:Object.fromEntries([...new Set(records.map(r=>r.dataStatus))].map(s=>[s,records.filter(r=>r.dataStatus===s).length])),
  nonQuarantined:records.filter(r=>r.dataStatus!=='quarantined').length,
  publishedWithClosedRegistration:records.filter(r=>r.dataStatus==='published'&&expired(r)).length,
  drafts:{total:drafts.length,expired:drafts.filter(expired).length,
    withoutClosingDate:drafts.filter(r=>!r.schedule?.registration_end).length,
    notKnownExpiredWithCoreFields:drafts.filter(r=>!expired(r)&&!missing(r).length).length,
    notKnownExpiredDirectoryOnly:drafts.filter(r=>!expired(r)&&directoryOnly(r)).length,
    missingFields:Object.fromEntries(['organizer','participants','eligibility','formatAndRules','professions'].map(k=>[k,drafts.filter(r=>k==='professions'?!r.professions?.length:!String(r[k]||'').trim()).length])),
  },
};
const report = path.join(here,'reports',`discovery-funnel-${Date.now()}.json`);
fs.mkdirSync(path.dirname(report),{recursive:true});
fs.writeFileSync(report,JSON.stringify({summary,rows},null,2),{mode:0o600});
console.log(JSON.stringify({summary,report,priority:rows.filter(r=>!r.expired&&!r.missing.length&&!directoryOnly({qualityIssues:r.issues})).map(r=>({id:r.id,name:r.name,end:r.schedule?.registration_end,source:r.source,issues:r.issues?.slice(-2)}))},null,2));
