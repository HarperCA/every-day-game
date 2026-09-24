// 从已保存的运行文件恢复一轮结果账。旧日志没有的字段保持未知。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPipelineLedger } from './pipeline-ledger.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const runDir = path.resolve(process.argv[2] || '');
const shouldWrite = process.argv.includes('--write');
if (!runDir.startsWith(path.join(here, 'runs') + path.sep) || !fs.existsSync(runDir)) {
  throw new Error('请传入 runs/ 下已有的运行目录');
}
const started = path.basename(runDir).replace(/^(.{10})T(\d\d)-(\d\d)-(\d\d)-(\d+)Z$/, '$1T$2:$3:$4.$5Z');
const logs = fs.readFileSync(path.join(here,'pipeline.log'),'utf8').split(/\r?\n/)
  .filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
const matching = logs.filter(entry => entry.at >= started && entry.at < new Date(Date.parse(started) + 6*60*60*1000).toISOString() && entry.summary);
if (!matching.length) throw new Error('未找到该轮运行汇总日志');
const entry = matching[0];
const report = buildPipelineLedger(runDir, { ...entry, startedAt:started });
if (report.qualifiedNew == null) {
  const crawlLog = '/var/log/daily-contest-crawl.log';
  if (fs.existsSync(crawlLog)) {
    const log = fs.readFileSync(crawlLog, 'utf8');
    const marker = `=== 发现新赛事流水线 ${started.slice(0, 19)}`;
    const from = log.lastIndexOf(marker);
    const segment = from < 0 ? '' : log.slice(from).split('\n=== 发现新赛事流水线 ')[0];
    if (/新增 0｜更新草稿 0｜跳过 \d+/.test(segment) && /没有需要写入的内容/.test(segment)) {
      report.qualifiedNew = 0;
      report.newRecords = 0;
      report.publishedNew = 0;
      report.publishedExisting = 0;
      report.publishedTotal = 0;
      report.existingEnriched = 0;
      report.existingUpdated = 0;
      report.measured.publishing = true;
    }
  }
}
console.log(JSON.stringify(report, null, 2));
if (!shouldWrite) process.exit(0);
const token = fs.readFileSync(path.join(here,'.admin-token'),'utf8').trim();
const response = await fetch('http://127.0.0.1:8787/api/adminData', {
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({adminToken:token,action:'savePipelineRun',run:report}),
});
const result = await response.json();
if (!result.ok) throw new Error(result.message || 'savePipelineRun failed');
console.log(`结果账已写入 ${report.id}`);
