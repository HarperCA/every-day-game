// 给已有赛事补海报（2026-10）：读每场比赛的报名网址和官方来源页，找海报（page-supplement.mjs 的 findPoster：
// 先用页面声明的封面图，没有再找页面上的赛事大图），只写给还没有海报的记录，不覆盖人工填的。
//
// 用法（服务器 /opt/daily-contest/ 下）：
//   node backfill-posters.mjs                 预演：只找、不写，结果写进 runs/poster-backfill-*.json
//   node backfill-posters.mjs --apply         写库：先备份整表到 backups/，再 saveRecords（带乐观锁和审计）
//   node backfill-posters.mjs --limit 20      只处理前 20 条
// 本地预览（只读公开接口，永远不写）：
//   node scripts/server/backfill-posters.mjs --public https://107-175-111-18.sslip.io --out report.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPoster } from './page-supplement.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const crawlerModule = name => import(`./crawler/lib/${name}.mjs`).catch(() => import(`../crawler/lib/${name}.mjs`));
const PAGES_PER_RECORD = 3;
const WORKERS = 4;

export function parseArgs(argv) {
  const args = { apply:false, limit:0, publicOrigin:'', out:'' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--apply') args.apply = true;
    if (argv[i] === '--limit') args.limit = Number(argv[i + 1]) || 0;
    if (argv[i] === '--public') args.publicOrigin = String(argv[i + 1] || '').replace(/\/$/, '');
    if (argv[i] === '--out') args.out = argv[i + 1];
  }
  if (args.apply && args.publicOrigin) throw new Error('--public 只读公开接口，不能和 --apply 一起用');
  return args;
}

// 一场比赛要读哪些页面：报名网址，再加官方来源页；去重，最多 3 个。后台记录和公开缓存字段名不同，两种都认
export function pagesOf(record) {
  const urls = [record.registrationUrl, record.registration_url,
    ...(record.sources || []).filter(source => source.is_official !== false || /organizer|authority/.test(source.source_type || '')).map(source => source.url)];
  return [...new Set(urls.filter(url => /^https?:\/\//i.test(String(url || ''))))].slice(0, PAGES_PER_RECORD);
}

const needsPoster = record => !/^https:\/\//i.test(record.posterUrl || record.poster_url || '');

// 只把找到的海报写给仍然没有海报的记录（期间有人手动填了就不动），返回新表和实际改了的条目
export function applyPosters(records, found) {
  const byId = new Map(found.map(item => [item.id, item]));
  const changed = [];
  const next = records.map(record => {
    const hit = byId.get(record.id);
    if (!hit || !needsPoster(record)) return record;
    changed.push({ id:record.id, name:record.name, posterUrl:hit.posterUrl, posterSource:hit.posterSource, page:hit.page });
    return { ...record, posterUrl:hit.posterUrl, posterSource:hit.posterSource };
  });
  return { records:next, changed };
}

async function searchAll(records, fetcher) {
  const results = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < records.length) {
      const record = records[cursor++];
      const tried = [];
      let hit = null;
      for (const url of pagesOf(record)) {
        const page = await fetcher.get(url).catch(error => ({ status:'error', error:String(error?.message || error) }));
        tried.push({ url, status:page.status });
        if (page.status !== 'ok' || !/html/i.test(page.contentType || '')) continue;
        const poster = await findPoster({ html:page.text, pageUrl:page.finalUrl || url, contestName:record.name }).catch(() => null);
        if (poster) { hit = { posterUrl:poster.url, posterSource:poster.source, page:page.finalUrl || url }; break; }
      }
      results.push({ id:record.id, name:record.name, tried, ...(hit || {}) });
      console.log(`[${results.length}/${records.length}] ${hit ? `✓ ${hit.posterSource === 'declared' ? '封面图' : '页面大图'}` : '× 没找到'}  ${String(record.name).slice(0, 28)}`);
    }
  };
  await Promise.all(Array.from({ length:WORKERS }, worker));
  return results;
}

async function loadPublicRecords(origin) {
  const call = async body => {
    const res = await fetch(`${origin}/api/publicData`, { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify(body), signal:AbortSignal.timeout(30000) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.message || 'publicData_failed');
    return json.data;
  };
  const ids = [];
  for (let page = 1; ; page += 1) {
    const list = await call({ action:'list', query:{ page, pageSize:100 } });
    ids.push(...list.items.slice(ids.length).map(item => item.id));
    if (!list.hasMore) break;
  }
  const records = [];
  for (const id of ids) records.push(await call({ action:'get', id }));
  return records;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { Fetcher } = await crawlerModule('fetcher');
  const fetcher = new Fetcher({ perHostDelayMs:1500 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let call = null;
  let records;
  if (args.publicOrigin) {
    records = await loadPublicRecords(args.publicOrigin);
  } else {
    const token = fs.readFileSync(path.join(HERE, '.admin-token'), 'utf8').trim();
    call = async body => {
      const res = await fetch('http://127.0.0.1:8787/api/adminData', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ adminToken:token, ...body }) });
      const json = await res.json();
      if (!json.ok) throw new Error(json.message || 'adminData_failed');
      return json.data;
    };
    records = (await call({ action:'bootstrap' })).records;
  }
  const todo = records.filter(needsPoster).slice(0, args.limit || undefined);
  console.log(`共 ${records.length} 条，没有海报的 ${todo.length} 条${args.limit ? `（只处理前 ${args.limit} 条）` : ''}\n`);
  const results = await searchAll(todo, fetcher);
  const found = results.filter(item => item.posterUrl);
  const report = {
    generatedAt:new Date().toISOString(), mode:args.publicOrigin ? 'public-preview' : args.apply ? 'apply' : 'dry-run',
    total:records.length, checked:results.length, found:found.length,
    declared:found.filter(item => item.posterSource === 'declared').length,
    pageImage:found.filter(item => item.posterSource === 'page_image').length,
    unreachable:results.filter(item => item.tried.length && item.tried.every(page => page.status !== 'ok')).length,
    results,
  };
  const out = args.out ? path.resolve(args.out) : path.join(HERE, 'runs', `poster-backfill-${stamp}.json`);
  fs.mkdirSync(path.dirname(out), { recursive:true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`\n找到 ${found.length}/${results.length}（封面图 ${report.declared}，页面大图 ${report.pageImage}），全部页面都打不开 ${report.unreachable} 条`);
  console.log(`报告：${out}`);
  if (!args.apply || !found.length) return;

  // 写库前重新读一次：找海报要跑很久，期间后台可能有人改过
  const fresh = await call({ action:'bootstrap' });
  const backupDir = path.join(HERE, 'backups', `poster-backfill-${stamp}`);
  fs.mkdirSync(backupDir, { recursive:true });
  fs.writeFileSync(path.join(backupDir, 'records-before.json'), JSON.stringify(fresh.records));
  const { records:next, changed } = applyPosters(fresh.records, found);
  fs.writeFileSync(path.join(backupDir, 'changed.json'), JSON.stringify(changed, null, 2));
  if (!changed.length) { console.log('期间都已有海报，没有要写的'); return; }
  const saved = await call({
    action:'saveRecords', records:next, expectedVersion:fresh.stateVersions.records,
    auditEntry:{ id:`poster-backfill-${Date.now()}`, action:'update', objectType:'event_edition', recordId:'batch',
      recordName:`补海报 ${changed.length} 条`, changedFields:['posterUrl', 'posterSource'], actor:'super_admin', createdAt:new Date().toISOString(),
      reason:`从官网补赛事海报（声明的封面图或页面上的赛事大图），只写给原来没有海报的记录；备份 ${backupDir}` },
  });
  console.log(`已写入 ${changed.length} 条，版本 ${saved.version}；备份 ${backupDir}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => { console.error('补海报失败:', error.message); process.exit(1); });
}
