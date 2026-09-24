// 发布验收：用户实际看到的公开数据，是否和管理库一致。
//
// 管理库里已发布、已归档的每条记录，逐条走公开接口（和小程序同一个 /api/publicData get），
// 核对能否取到、关键字段是否与 toPublicCache 由管理记录算出的一致；
// 其余状态（草稿、待审、隔离、下架）必须取不到。只读，不写库。
//
// 用法：node verify-public-cache.mjs [--out reports/public-cache-acceptance-YYYY-MM-DD.json]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = 'http://127.0.0.1:8787/api';
const PUBLIC = new Set(['published', 'archived']);
export const COMPARED_FIELDS = ['name', 'edition_year', 'edition_ordinal', 'organizer', 'event_level', 'registration_url',
  'registration_start', 'registration_end', 'registration_status', 'professions', 'participation_format', 'team_size_category',
  'fee_type', 'registration_organization', 'data_status'];

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// expected：toPublicCache 算出的文档，或它抛出的错误；actual：公开接口的返回。
export function compareOne(record, expected, actual) {
  const shouldBePublic = PUBLIC.has(record.dataStatus);
  if (!shouldBePublic) return actual.ok ? { id:record.id, name:record.name, problem:'不该公开却能取到', status:record.dataStatus } : null;
  if (expected.error) return { id:record.id, name:record.name, problem:`管理记录过不了公开缓存门槛：${expected.error}`, status:record.dataStatus, publicVisible:actual.ok };
  if (!actual.ok) return { id:record.id, name:record.name, problem:`公开接口取不到：${actual.message || '未知'}`, status:record.dataStatus };
  const diffs = COMPARED_FIELDS.filter(field => !same(expected.doc[field], actual.data[field]))
    .map(field => ({ field, expected:expected.doc[field] ?? null, actual:actual.data[field] ?? null }));
  return diffs.length ? { id:record.id, name:record.name, problem:'字段不一致', status:record.dataStatus, diffs } : null;
}

async function post(endpoint, body) {
  const response = await fetch(`${API}/${endpoint}`, { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify(body) });
  return response.json();
}

async function main() {
  const argv = process.argv.slice(2);
  const now = new Date();
  const out = argv.includes('--out') ? path.resolve(argv[argv.indexOf('--out') + 1])
    : path.join(HERE, 'reports', `public-cache-acceptance-${now.toISOString().slice(0, 10)}.json`);
  const { toPublicCache } = createRequire(import.meta.url)(path.join(HERE, 'cjs', 'publicCache.js'));
  const token = fs.readFileSync(path.join(HERE, '.admin-token'), 'utf8').trim();
  const bootstrap = await post('adminData', { adminToken:token, action:'bootstrap' });
  if (!bootstrap.ok) throw new Error(bootstrap.message || 'bootstrap_failed');
  const problems = [];
  const counts = { checked:0, public:0 };
  for (const record of bootstrap.data.records) {
    let expected;
    try { expected = { doc:toPublicCache(record, now) }; } catch (error) { expected = { error:error.message }; }
    const actual = await post('publicData', { action:'get', id:record.id });
    counts.checked += 1;
    if (actual.ok) counts.public += 1;
    const problem = compareOne(record, expected, actual);
    if (problem) problems.push(problem);
  }
  const byProblem = problems.reduce((acc, item) => { const key = item.problem.split('：')[0]; acc[key] = (acc[key] || 0) + 1; return acc; }, {});
  const report = { at:now.toISOString(), ...counts, problems:problems.length, byProblem, details:problems };
  fs.mkdirSync(path.dirname(out), { recursive:true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ at:report.at, ...counts, problems:problems.length, byProblem }));
  console.log(`验收报告：${out}`);
  if (problems.length) process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
