// 只读盘点赛事名称与届次信息的现状。
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { normalizeEditionTitle } = require('/opt/daily-contest/cjs/editionTitle.js');
const { toPublicCache } = require('/opt/daily-contest/functions/adminData/publicCache.js');
const { classifyCompetitionScope } = require('/opt/daily-contest/functions/adminData/competitionScope.js');
const token = (await fs.readFile('/opt/daily-contest/.admin-token', 'utf8')).trim();
const response = await fetch('http://127.0.0.1:8787/api/adminData', {
  method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({adminToken:token, action:'bootstrap'}),
});
const result = await response.json();
if (!result.ok) throw new Error(result.message);
const records = result.data.records;
const proposals = records.map((record, index) => ({index, id:record.id, original:record.name, editionName:record.editionName, status:record.dataStatus, ...normalizeEditionTitle(record)}));
const changes = proposals.filter(item => item.original !== item.name || item.editionYear || item.editionOrdinal);
const issues = proposals.filter(item => item.issues.length);
const collisions = new Map();
for (const item of proposals) {
  const key = `${item.name}\n${item.editionYear}\n${item.editionOrdinal}`;
  collisions.set(key, [...(collisions.get(key) || []), item]);
}
const duplicates = [...collisions.values()].filter(items => items.length > 1);
const cacheFailures = [];
const scopeFailures = [];
for (const item of proposals) {
  const changed = item.name !== item.original || item.editionYear !== (records[item.index].editionYear || '') || item.editionOrdinal !== (records[item.index].editionOrdinal || '');
  if (!changed) continue;
  const normalized = {...records[item.index], name:item.name, editionYear:item.editionYear, editionOrdinal:item.editionOrdinal};
  const scope = classifyCompetitionScope(normalized);
  if (scope.decision !== 'eligible') scopeFailures.push({id:item.id, name:item.original, status:item.status, scope});
  if (!['published','archived'].includes(item.status)) continue;
  try { toPublicCache(normalized); }
  catch (error) { cacheFailures.push({id:item.id, name:item.original, error:String(error.message)}); }
}
console.log(JSON.stringify({version:result.data.stateVersions.records,total:records.length,changes:changes.length,yearKnown:proposals.filter(x => x.editionYear).length,ordinalKnown:proposals.filter(x => x.editionOrdinal).length,issues:issues.length,collisions:duplicates.length,cacheFailures:cacheFailures.length,scopeFailures:scopeFailures.length,cacheFailureSamples:cacheFailures.slice(0,20),scopeFailureSamples:scopeFailures.slice(0,20),issueSamples:issues.slice(0,10),collisionSamples:duplicates.slice(0,8).map(items => items.map(x => ({id:x.id,original:x.original,name:x.name,editionYear:x.editionYear,editionOrdinal:x.editionOrdinal}))),changeSamples:changes.slice(0,8).map(x => ({original:x.original,name:x.name,editionYear:x.editionYear,editionOrdinal:x.editionOrdinal}))}, null, 2));
