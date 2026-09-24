// 只读统计中国赛事，不输出管理员口令。
import fs from 'node:fs/promises';
const token = (await fs.readFile('/opt/daily-contest/.admin-token', 'utf8')).trim();
const response = await fetch('http://127.0.0.1:8787/api/adminData', {
  method: 'POST', headers: {'content-type': 'application/json'},
  body: JSON.stringify({adminToken: token, action: 'bootstrap'}),
});
const result = await response.json();
if (!response.ok || !result.ok) throw new Error(result.message || `HTTP ${response.status}`);
const records = result.data.records;
const locations = records.reduce((counts, record) => {
  const value = record.country || record.region || record.location?.country || record.countryCode || '(未填写)';
  counts[value] = (counts[value] || 0) + 1;
  return counts;
}, {});
const nonChina = records.filter(record => {
  const text = [record.country, record.region, record.location?.country, record.countryCode, record.eventLevel, record.organizer, record.eligibility].filter(Boolean).join(' ');
  return /国际|全球|海外|world|global|international/i.test(text);
}).map(record => ({id: record.id, name: record.name, status: record.dataStatus, country: record.country, region: record.region, eventLevel: record.eventLevel}));
console.log(JSON.stringify({version: result.data.stateVersions.records, total: records.length, normalLibrary: records.filter(record => record.dataStatus !== 'quarantined').length, published: records.filter(record => record.dataStatus === 'published').length, quarantined: records.filter(record => record.dataStatus === 'quarantined').length, locations, possibleInternational: nonChina.length, possibleInternationalSamples: nonChina.slice(0, 20)}, null, 2));
