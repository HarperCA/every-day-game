// 把库里当前的全部记录（种子 + 已抓取入库的草稿）导出成
// merge-candidates.mjs 认识的 seed 形状，这样新一轮抓取的判重
// 能覆盖到「已经抓过还没发布」的记录，不会只比对静态种子文件、
// 漏掉上一轮天池抓来的 14 条。
// 用法：node apps/admin/scripts/export-live-masters.mjs [输出路径]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cloudbase from '@cloudbase/js-sdk';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const TOKEN_FILE = path.join(ROOT, '.admin-token.local');
const ENV_ID = process.env.CLOUDBASE_ENV_ID || 'daily-contest-dev-d8dbbhc653e221';
const OUT = path.resolve(process.cwd(), process.argv[2] || 'reports/live-masters.json');

function readAdminToken() {
  const line = fs.readFileSync(TOKEN_FILE, 'utf8').split(/\r?\n/).find(l => /^\s*ADMIN_TOKEN\s*=/.test(l));
  const token = line?.replace(/^\s*ADMIN_TOKEN\s*=\s*/, '').trim();
  if (!token) throw new Error(`missing ADMIN_TOKEN in ${TOKEN_FILE}`);
  return token;
}

async function main() {
  const adminToken = readAdminToken();
  const app = cloudbase.init({ env:ENV_ID });
  const auth = app.auth();
  if (!await auth.getLoginState()) await auth.signInAnonymously();
  const rd = r => typeof r?.result === 'string' ? JSON.parse(r.result) : r?.result;
  const bs = rd(await app.callFunction({ name:'adminData', data:{ adminToken, action:'bootstrap' }, parse:true }));
  const records = bs.data.records || [];

  const event_masters = [];
  const seenEvent = new Set();
  const event_editions = [];
  const data_sources = [];
  for (const record of records) {
    if (!seenEvent.has(record.eventId)) {
      seenEvent.add(record.eventId);
      event_masters.push({
        id:record.eventId,
        standard_name:record.name,
        aliases:record.aliases || [],
        website_url:(record.sources || [])[0]?.url || '',
      });
    }
    event_editions.push({ id:record.id, event_id:record.eventId });
    for (const source of record.sources || []) {
      data_sources.push({ edition_id:record.id, url:source.url });
    }
  }

  fs.writeFileSync(OUT, JSON.stringify({ event_masters, event_editions, data_sources }, null, 2), 'utf8');
  console.log(`导出 ${event_masters.length} 个赛事主条目（来自库里 ${records.length} 条记录）→ ${OUT}`);
}

main().catch(error => { console.error('失败:', error.message); process.exit(1); });
