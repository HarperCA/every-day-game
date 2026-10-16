// 把代理（agent-trace.mjs）找到的官方来源，原样放进现有流水线的“读详情 → AI 抽取 → 入库检查”，看会有多少条入库。
// 不写库（入库一步固定 --dry-run），中间文件放在 /tmp/agent-replay/，不碰 runs/ 目录。
// 用法：node agent-replay.mjs <运行目录> [--limit N]
// 和原流程的对应：代理给出官方网址，相当于“通知追溯”找到了待核验页面；之后的读详情、抽取、同名判重、范围检查、入库门槛都是现成的。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { buildMastersFromRecords } from './crawler/lib/masters.mjs';
import { matchByUrlOnly, hostOf } from './crawler/lib/dedupe.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const runDir = process.argv[2];
const limit = Number((process.argv.includes('--limit') && process.argv[process.argv.indexOf('--limit') + 1]) || 0);
if (!runDir) { console.error('用法：node agent-replay.mjs <运行目录> [--limit N]'); process.exit(1); }
const OUT = '/tmp/agent-replay';
fs.mkdirSync(OUT, { recursive: true });

const results = fs.readFileSync(path.join(runDir, 'agent-trace-results.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const adminToken = fs.readFileSync(path.join(HERE, '.admin-token'), 'utf8').trim();
const res = await fetch('http://127.0.0.1:8787/api/adminData', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken, action: 'bootstrap' }) });
const records = (await res.json()).data.records;
const masters = buildMastersFromRecords(records);

const seen = new Set();
const candidates = [];
let alreadyKnown = 0;
let noSource = 0;
for (const result of results) {
  if (result.outcome !== 'found_official') continue;
  const sources = (result.sources || []).filter(source => /^https?:\/\//i.test(source.url || ''));
  if (!sources.length) { noSource += 1; continue; }
  for (const source of sources.slice(0, 2)) {
    if (seen.has(source.url)) continue;
    seen.add(source.url);
    const candidate = {
      externalId: `agent-followup-${createHash('sha256').update(source.url).digest('hex').slice(0, 16)}`,
      name: String(result.contest_name || '').trim(), proposedCompetitionName: String(result.contest_name || '').trim(),
      detailUrl: source.url, introduction: `代理找到的官方来源：${String(source.evidence || '').slice(0, 400)}`,
      discoveryNoticeUrl: result.noticeUrl, fromNoticeText: true, tags: [], source: '通知追溯',
      discovery: { route: '追溯线索与主办方监测', query: null, source: '通知追溯', via: { noticeUrl: result.noticeUrl, noticeTitle: result.noticeTitle } },
    };
    // 和原流程一样：通知正文里写出的网址只按网址判重，库里已有这个网址就不再处理
    if (matchByUrlOnly(candidate, masters)) { alreadyKnown += 1; continue; }
    candidates.push(candidate);
  }
}
const picked = limit ? candidates.slice(0, limit) : candidates;
const combined = path.join(OUT, 'combined-candidates.json');
const extracted = path.join(OUT, 'combined-extracted.json');
fs.writeFileSync(combined, JSON.stringify({ candidates: picked }, null, 2));
console.log(`代理找到官方来源的通知 ${results.filter(r => r.outcome === 'found_official').length} 篇 → 官方网址 ${seen.size} 个（库里已有该网址 ${alreadyKnown} 个，没有网址 ${noSource} 篇）→ 进入读详情 ${picked.length} 个`);

const run = (script, args) => execFileSync('node', [script, ...args], { cwd: HERE, stdio: 'inherit', timeout: 3600000 });
run('run-extract.mjs', ['--in', combined, '--out', extracted]);
run('ingest-candidates.mjs', ['--candidates', combined, '--extracted', extracted, '--dry-run']);
console.log(`完成。报告在 ${OUT}/`);
