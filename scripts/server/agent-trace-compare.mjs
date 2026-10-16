// 对比一轮运行里“原来的通知追溯”和“代理版追溯”（agent-trace.mjs）对同一批通知的处理结果。
// 只读。用法：node agent-trace-compare.mjs <运行目录>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadRunDetail } = require('./functions/adminData/pipelineRunDetail.js');

const runDir = process.argv[2];
if (!runDir) { console.error('用法：node agent-trace-compare.mjs <运行目录>'); process.exit(1); }
const runId = path.basename(runDir);
const detail = loadRunDetail(runId);
const agent = new Map(fs.readFileSync(path.join(runDir, 'agent-trace-results.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).map(item => [item.noticeUrl, item]));

// 库里已有的赛事名（非隔离），用来判断代理找到的比赛是不是新的
const adminToken = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const res = await fetch('http://127.0.0.1:8787/api/adminData', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken, action: 'bootstrap' }) });
const records = (await res.json()).data.records.filter(record => record.dataStatus !== 'quarantined');
const norm = text => String(text || '').replace(/第.{1,4}届|20\d\d年?|[^一-鿿A-Za-z0-9]/g, '');
const libNames = records.map(record => norm(record.name)).filter(name => name.length >= 4);
const inLibrary = name => { const key = norm(name); return key.length >= 4 && libNames.some(lib => lib === key || (key.length >= 6 && (lib.includes(key) || key.includes(lib)))); };

const rows = detail.rows;
const byUrl = new Map(rows.map(row => [row.url, row]));
const childrenOf = row => rows.filter(other => other.no && row.no && other.no.startsWith(`${row.no}.`));

function original(row) {
  if (!row) return 'missing';
  if (/^追溯没找到/.test(row.final)) return '追溯没找到';
  if (/^转入通知追溯/.test(row.final)) {
    const kids = childrenOf(row);
    if (kids.some(kid => /已写入后台|补来源/.test(kid.final))) return '追溯后入库';
    if (kids.some(kid => /^读了详情页/.test(kid.final))) return '读了详情页但没入库';
    return '找到页面但没读';
  }
  return `其他：${String(row.final).slice(0, 20)}`;
}

const table = {};
const examples = {};
const costs = { total: 0, turns: 0 };  // total 是 token 数
const newCompetitions = [];
for (const [url, result] of agent) {
  const row = byUrl.get(url);
  const before = original(row);
  const outcome = result.outcome;
  table[before] ??= {};
  table[before][outcome] = (table[before][outcome] || 0) + 1;
  costs.total += result.tokens || 0; costs.turns += result.turns || 0;
  if (outcome === 'found_official') {
    const known = inLibrary(result.contest_name);
    (examples[`${before} → 代理找到官方来源${known ? '（库里已有）' : '（库里没有）'}`] ??= []).push(`${result.contest_name || '?'}｜${(result.sources || [])[0]?.url || ''}`);
    if (!known) newCompetitions.push({ noticeUrl: url, noticeTitle: result.noticeTitle, contest: result.contest_name, level: result.level, sources: (result.sources || []).map(source => source.url), original: before });
  }
}
const total = agent.size;
const count = outcome => [...agent.values()].filter(item => item.outcome === outcome).length;
console.log(`通知 ${total} 条｜代理用量 ${costs.total} token（平均每条 ${Math.round(costs.total / Math.max(total, 1))}，${(costs.turns / Math.max(total, 1)).toFixed(1)} 轮）`);
console.log('代理结论：', Object.fromEntries(['found_official', 'not_competition', 'sub_track', 'not_found', 'unreadable', 'bad_output', 'error', 'skipped_budget'].map(key => [key, count(key)]).filter(([, n]) => n)));
console.log('\n原来的去向 × 代理结论：');
for (const [before, outcomes] of Object.entries(table)) console.log(`  ${before}：${Object.entries(outcomes).map(([k, n]) => `${k} ${n}`).join('，')}`);
console.log(`\n代理找到官方来源、而且库里还没有的比赛：${newCompetitions.length} 个`);
for (const item of newCompetitions) console.log(`  原来：${item.original}｜${item.contest}｜${item.sources[0] || ''}`);
fs.writeFileSync(path.join(runDir, 'agent-trace-compare.json'), JSON.stringify({ total, costs, table, newCompetitions }, null, 1));
