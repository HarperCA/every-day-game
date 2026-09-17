// 把抓取候选写入后台，一律为草稿。
//
// 走的是后台本来就有的 saveRecords：它带乐观锁（expectedVersion）和审计，
// 并且在同一个事务里同步公开缓存 —— 只有 published 的记录才会进缓存，
// 所以草稿写进去不会出现在小程序里。不另起一条写入路径。
//
// 三条纪律：
//   1. 一律 draft，manualReview=pending。发布闸必然拦住，人工确认才能发。
//   2. 按 id 去重。重跑只更新既有草稿，不会产生第二条。
//   3. 已经人工动过的记录（manualReview 不再是 pending）一律跳过 ——
//      抓取不能覆盖人的判断。
//
// 用法：node ingest-candidates.mjs --candidates x.json --extracted y.json [--dry-run] [--only-admitted]
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import cloudbase from '@cloudbase/js-sdk';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CJS_DIR = path.join(HERE, 'cjs');
const TOKEN_FILE = path.join(HERE, '.admin-token');
const ENV_ID = process.env.CLOUDBASE_ENV_ID || 'daily-contest-dev-d8dbbhc653e221';

const require = createRequire(import.meta.url);
const { candidateToRecord } = require(path.join(CJS_DIR, 'candidateToRecord.js'));
const { assessAdmission } = require(path.join(CJS_DIR, 'competitionAdmission.js'));

function parseArgs(argv) {
  const args = { candidates:'', extracted:'', dryRun:false, onlyAdmitted:false, allowEmptyBase:false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--candidates') args.candidates = argv[i + 1];
    if (argv[i] === '--extracted') args.extracted = argv[i + 1];
    if (argv[i] === '--dry-run') args.dryRun = true;
    if (argv[i] === '--only-admitted') args.onlyAdmitted = true;
    if (argv[i] === '--allow-empty-base') args.allowEmptyBase = true;
  }
  if (!args.candidates) throw new Error('必须指定 --candidates <候选文件>');
  return args;
}

function readToken() {
  if (!fs.existsSync(TOKEN_FILE)) throw new Error(`缺少口令文件 ${TOKEN_FILE}`);
  const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  if (!token) throw new Error(`口令文件 ${TOKEN_FILE} 是空的`);
  return token;
}

// 把抽取结果并回候选，收录门槛才能看到主办方和权威信号。
function withExtraction(candidate, extraction) {
  if (!extraction?.ok) return { ...candidate };
  return {
    ...candidate,
    organizer:extraction.extracted.organizer?.value || candidate.organizer,
    authority_signals:extraction.extracted.authority_signals,
    reward_highlights:extraction.extracted.reward_highlights.map(item => item.value),
    recognition:extraction.extracted.recognition_hints.map(hint => ({
      path:hint.path, level:hint.level, evidence:hint.quote, scope:hint.scope || [],
    })),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const candidates = JSON.parse(await fsp.readFile(path.resolve(HERE, args.candidates), 'utf8')).candidates || [];
  const extractions = args.extracted
    ? (JSON.parse(await fsp.readFile(path.resolve(HERE, args.extracted), 'utf8')).results || [])
    : [];

  const app = cloudbase.init({ env:ENV_ID });
  const auth = app.auth();
  if (!await auth.getLoginState()) await auth.signInAnonymously();
  const adminToken = readToken();
  const call = async data => {
    const response = await app.callFunction({ name:'adminData', data:{ adminToken, ...data }, parse:true });
    const result = typeof response?.result === 'string' ? JSON.parse(response.result) : response?.result;
    if (!result?.ok) throw new Error(result?.message || 'adminData 返回异常');
    return result.data;
  };

  const snapshot = await call({ action:'bootstrap' });
  // bootstrap 返回的是 { records, stateVersions:{ records } }，不是嵌在 competitions 下。
  // 一开始读错字段，拿到空数组 —— 若照此写入，next 就是「空 + 新候选」，
  // 会把库里已有的记录全部覆盖掉。dry-run 才把这个问题拦下来。
  const existing = Array.isArray(snapshot?.records) ? snapshot.records : null;
  const version = snapshot?.stateVersions?.records;
  if (existing === null) throw new Error('bootstrap 未返回 records 数组，拒绝写入');
  console.log(`库中现有 ${existing.length} 条，version=${version}`);
  // saveRecords 是整表替换。读到空表要么库真的空，要么读法又错了 ——
  // 后者的代价是抹掉全部数据，所以默认拒绝，必须显式确认。
  if (!existing.length && !args.allowEmptyBase) {
    throw new Error('读到的现有记录为空。saveRecords 是整表替换，这可能抹掉全部数据；确认库确实为空后加 --allow-empty-base');
  }

  const byId = new Map(existing.map(record => [record.id, record]));
  const next = [...existing];
  const added = [];
  const updated = [];
  const skipped = [];

  for (const candidate of candidates) {
    const extraction = extractions.find(item => item.url === candidate.detailUrl);
    const verdict = assessAdmission(withExtraction(candidate, extraction)).verdict;
    if (args.onlyAdmitted && verdict !== 'admit') { skipped.push([candidate.name, `门槛 ${verdict}`]); continue; }
    if (verdict === 'out_of_scope' || verdict === 'reject') { skipped.push([candidate.name, `门槛 ${verdict}`]); continue; }

    const record = candidateToRecord(candidate, extraction);
    const current = byId.get(record.id);
    if (!current) {
      next.push(record);
      added.push([candidate.name, verdict]);
      continue;
    }
    // 人已经动过的记录，抓取不能覆盖
    if (current.manualReview !== 'pending' || current.dataStatus !== 'draft') {
      skipped.push([candidate.name, `已人工处理（${current.dataStatus}/${current.manualReview}）`]);
      continue;
    }
    next[next.indexOf(current)] = record;
    updated.push([candidate.name, verdict]);
  }

  console.log(`\n新增 ${added.length}｜更新草稿 ${updated.length}｜跳过 ${skipped.length}`);
  for (const [name, why] of added) console.log(`  + ${why.padEnd(7)} ${name.slice(0, 34)}`);
  for (const [name, why] of updated) console.log(`  ~ ${why.padEnd(7)} ${name.slice(0, 34)}`);
  for (const [name, why] of skipped) console.log(`  - ${String(why).padEnd(24)} ${name.slice(0, 30)}`);

  if (args.dryRun) { console.log('\n--dry-run：未写入。'); return; }
  if (!added.length && !updated.length) { console.log('\n没有需要写入的内容。'); return; }

  const auditEntry = {
    id:`ingest-${Date.now()}`,
    action:'create',
    objectType:'event_edition',
    recordId:added[0]?.[0] ? next[next.length - 1].id : (updated[0] ? 'batch-update' : 'batch'),
    recordName:`抓取入库：新增 ${added.length} 条，更新 ${updated.length} 条`,
    changedFields:['dataStatus'],
    changes:{ dataStatus:{ before:null, after:'draft' } },
    reason:'来自服务器抓取与抽取，一律以草稿入库，待人工复核',
    createdAt:new Date().toISOString(),
  };
  // 整表替换的最后一道自检：写回去的条数不该少于原有条数。
  if (next.length < existing.length) {
    throw new Error(`拒绝写入：将要写回 ${next.length} 条，少于现有 ${existing.length} 条`);
  }
  const result = await call({ action:'saveRecords', records:next, expectedVersion:version, auditEntry });
  console.log(`\n已写入：${result.saved} 条，version ${version} → ${result.version}`);
  console.log(`公开缓存：发布 ${result.publicCachePublished ?? 0}，移除 ${result.publicCacheRemoved ?? 0}（草稿不进缓存）`);
}

main().catch(error => {
  console.error('入库失败:', error.message);
  process.exit(1);
});
