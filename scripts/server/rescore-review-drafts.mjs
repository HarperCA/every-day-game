// 给"review"判定的草稿定期重新打分——不重新抓取，纯本地用记录里已经存好
// 的数据（主办方、回报、认可度、质量问题清单）重新跑一遍收录打分公式；
// 还是过不了关键词打分门槛的，再送 DeepSeek 读一遍同样这份资料判断一次
// （跟 ingest-candidates.mjs 入库时的二次判断是同一个函数、同一套标准）。
//
// 为什么需要重新打分：分数只在草稿第一次写入库里那一刻算一次，之后就再
// 也不会重算。实测过一条真实案例——"蚂蚁灵波具身大模型挑战赛"，当时因为
// 抽取结果不全被判成 review，但库里其实已经存着后来补全的回报信息，用
// 现在的数据重新算，分数已经过门槛，只是没人重新算过。
//
// 为什么还需要 AI 二次判断：关键词正则只认"教育部""XX学会"这几种措辞，
// 主办方是知名企业/技术平台、真有实质投入的赛事，怎么加白名单都会漏判，
// 需要能读懂上下文的判断兜底。
//
// 判定过门槛的（不管是重新打分过的还是 AI 判定过的），走跟新入库候选
// 完全相同的分档流程（applyIntakeDecision）：该归档归档、该送三项核验
// 送核验、真通过了直接发布。
//
// 用法：node rescore-review-drafts.mjs [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { applyIntakeDecision, flushReasoning, logReasoning } from './ingest-candidates.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CJS_DIR = path.join(HERE, 'cjs');
const TOKEN_FILE = path.join(HERE, '.admin-token');
const EXTRACT_AI_KEY_FILE = path.join(HERE, '.extract-key');
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8787';
const ADMISSION_JUDGMENT_DELAY_MS = 600;

// 跟 ingest-candidates.mjs 的 primeExtractAiEnv 是同一套配置来源——
// review 档的二次判断走 DeepSeek（EXTRACT_ 前缀），不占 Kimi 那条线的额度。
function primeExtractAiEnv() {
  if (!fs.existsSync(EXTRACT_AI_KEY_FILE)) return false;
  const key = fs.readFileSync(EXTRACT_AI_KEY_FILE, 'utf8').trim();
  if (!key) return false;
  process.env.EXTRACT_AI_API_KEY = process.env.EXTRACT_AI_API_KEY || key;
  process.env.EXTRACT_AI_BASE_URL = process.env.EXTRACT_AI_BASE_URL || 'https://api.deepseek.com';
  process.env.EXTRACT_AI_MODEL = process.env.EXTRACT_AI_MODEL || 'deepseek-chat';
  return true;
}
const extractAiConfigured = primeExtractAiEnv();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const require = createRequire(import.meta.url);
const { assessAdmission } = require(path.join(CJS_DIR, 'competitionAdmission.js'));
const { judgeAdmissionWithAi } = require(path.join(CJS_DIR, 'competitionAdmissionAi.js'));

function readToken() {
  if (!fs.existsSync(TOKEN_FILE)) throw new Error(`缺少口令文件 ${TOKEN_FILE}`);
  const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  if (!token) throw new Error(`口令文件 ${TOKEN_FILE} 是空的`);
  return token;
}

// 把持久化的记录字段，映射回收录打分函数期望的输入形状——只用已经存在
// 记录上的字段，不猜、不补数据。qualityIssues 是权威性线索原文引证最后
// 落脚的地方，拿它当 introduction 的替身去扫 AUTHORITY_PATTERNS。
function admissionInputFromRecord(record) {
  return {
    organizer:record.organizer,
    introduction:(record.qualityIssues || []).join('\n'),
    rewards:record.rewards,
    formatAndRules:record.formatAndRules,
    registrationMethod:record.registrationMethod,
    fees:record.fees,
    rewardHighlights:record.rewardHighlights,
    recognition:record.recognition,
    tier:record.tier,
    parentEventId:record.parentEventId,
    advancesTo:record.advancesTo,
  };
}

function parseArgs(argv) {
  return { dryRun:argv.includes('--dry-run') };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const adminToken = readToken();
  const call = async data => {
    const response = await fetch(`${API_BASE}/api/adminData`, {
      method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ adminToken, ...data }),
    });
    const result = await response.json();
    if (!result?.ok) throw new Error(result?.message || 'adminData 返回异常');
    return result.data;
  };

  const snapshot = await call({ action:'bootstrap' });
  const existing = Array.isArray(snapshot?.records) ? snapshot.records : null;
  const version = snapshot?.stateVersions?.records;
  if (existing === null) throw new Error('bootstrap 未返回 records 数组，拒绝写入');

  // 只挑"当时判成 review、至今没人动过"的草稿——已经人工处理过的、
  // 或已经在走三项核验/hold 流程的（有 aiFieldVerification 或
  // stalenessExempt 标记）都跳过，不重复处理。
  // admissionVerdict 字段是这次改动才加的，老草稿身上没有这个字段——
  // 缺失和明确写着 'review' 一视同仁，都当作"没复检过"处理，不然这批
  // 老草稿永远进不了复检范围。
  const candidates = existing.filter(record => record.dataStatus === 'draft'
    && record.manualReview === 'pending'
    && (record.admissionVerdict === 'review' || !record.admissionVerdict)
    && !record.aiFieldVerification
    && !record.stalenessExempt);

  console.log(`库中现有 ${existing.length} 条，review 档待复检 ${candidates.length} 条`);
  if (!candidates.length) { console.log('没有需要复检的草稿。'); return; }

  const now = new Date();
  // 只记"哪条 id 变成了什么"，不直接拼最终数组——这批候选逐条核验要跑
  // 很久（真调 Kimi），跑的这段时间后台其他每 5 分钟一次的定时任务
  // 也在改同一份数据，最后存的时候版本号大概率已经对不上。存的时候按
  // id 把这份结果重新贴到最新数据上重试，而不是白跑一遍 Kimi 调用。
  const updatedById = new Map();
  const deletedById = new Map();
  const promoted = [];
  const stillReview = [];

  for (const record of candidates) {
    const admissionInput = admissionInputFromRecord(record);
    let rescoredVerdict = assessAdmission(admissionInput).verdict;
    let judgmentNote = null;

    if (rescoredVerdict !== 'admit' && extractAiConfigured && !args.dryRun) {
      try {
        const judgment = await judgeAdmissionWithAi(admissionInput, undefined, { onReasoning:logReasoning(record, { stage:'复检收录判断' }) });
        if (judgment.worth_including && judgment.confident) rescoredVerdict = 'admit';
        judgmentNote = `AI收录判断：${judgment.worth_including ? '认为有收录价值' : '认为价值不足'}（${judgment.confident ? '有把握' : '没把握，仍按原判定处理'}）｜${judgment.reason}`;
      } catch (error) {
        judgmentNote = `AI收录判断调用失败（${String(error?.message || error).slice(0, 200)}）`;
      } finally {
        await sleep(ADMISSION_JUDGMENT_DELAY_MS);
      }
    }

    if (rescoredVerdict !== 'admit' && rescoredVerdict !== 'review') { stillReview.push(record.name); continue; }

    const withNote = judgmentNote ? { ...record, qualityIssues:[...record.qualityIssues, judgmentNote] } : record;
    const outcome = await applyIntakeDecision({ ...withNote, admissionVerdict:rescoredVerdict }, existing, now, { dryRun:args.dryRun });
    if (outcome.record) updatedById.set(record.id, { ...outcome.record, admissionVerdict:rescoredVerdict });
    else deletedById.set(record.id, { record, reason:outcome.reason, agentResult:outcome.agentResult, decidedAt:now.toISOString() });
    promoted.push([record.name, outcome.label]);
  }

  console.log(`\n复检及代理处置：${promoted.length} 条｜收录规则拒绝或范围不符：${stillReview.length} 条`);
  for (const [name, label] of promoted) console.log(`  + ${label.padEnd(12)} ${name.slice(0, 34)}`);

  // 收录判断和三项核验的思考过程（见 ingest-candidates.mjs 的 reasoningLog）
  await flushReasoning(call, { dryRun:args.dryRun });
  const deletionBackupFile = path.join(HERE, `rescore-kimi-deletion-backup-${Date.now()}.json`);
  if (deletedById.size) fs.writeFileSync(deletionBackupFile, JSON.stringify({ createdAt:now.toISOString(), dryRun:args.dryRun, persisted:false, records:[...deletedById.values()] }, null, 2));
  if (args.dryRun) { console.log('\n--dry-run：未写入。'); return; }
  if (!promoted.length) { console.log('\n没有需要写入的变更。'); return; }

  const auditEntry = {
    id:`rescore-${Date.now()}`,
    action:'update',
    objectType:'event_edition',
    recordId:'batch',
    recordName:`review 档复检及代理处置：${promoted.length} 条`,
    changedFields:['admissionVerdict', 'dataStatus'],
    changes:{},
    reason:deletedById.size ? `复检后Kimi代理补查；完整删除备份：${deletionBackupFile}；${[...deletedById].map(([id,item]) => `${id}：${item.reason}`).join('；')}` : '定期用记录已有数据重新打分；关键词打分仍不够的，再送 DeepSeek 判断一次',
    createdAt:new Date().toISOString(),
  };

  const MAX_SAVE_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_SAVE_RETRIES; attempt += 1) {
    const base = attempt === 1 ? { records:existing, version } : await (async () => {
      const fresh = await call({ action:'bootstrap' });
      if (!Array.isArray(fresh?.records)) throw new Error('bootstrap 未返回 records 数组，拒绝重试写入');
      return { records:fresh.records, version:fresh?.stateVersions?.records };
    })();
    // 重跑过的候选如果在这段时间被人工动过（manualReview 不再是 pending），
    // 尊重人的判断，这次不覆盖它——跟 ingest-candidates.mjs 的纪律一致。
    const originals = new Map(existing.map(record => [record.id, record]));
    const nextRecords = base.records.filter(record => !deletedById.has(record.id)
      || JSON.stringify(record) !== JSON.stringify(originals.get(record.id))).map(record => {
      const updated = updatedById.get(record.id);
      if (!updated) return record;
      if (record.manualReview !== 'pending' || record.dataStatus !== 'draft'
        || JSON.stringify(record) !== JSON.stringify(originals.get(record.id))) return record;
      return updated;
    });
    try {
      const result = await call({ action:'saveRecords', records:nextRecords, expectedVersion:base.version, auditEntry });
      if (deletedById.size) fs.writeFileSync(deletionBackupFile, JSON.stringify({ createdAt:now.toISOString(), dryRun:false, persisted:true,
        removedIds:base.records.filter(record => !nextRecords.some(item => item.id === record.id)).map(record => record.id),
        version:result.version, records:[...deletedById.values()] }, null, 2));
      console.log(`\n已写入：${result.saved} 条，version ${base.version} → ${result.version}${attempt > 1 ? `（第 ${attempt} 次尝试成功）` : ''}`);
      console.log(`公开缓存：发布 ${result.publicCachePublished ?? 0}，移除 ${result.publicCacheRemoved ?? 0}`);
      return;
    } catch (error) {
      if (!/state_version_conflict/.test(String(error?.message || '')) || attempt === MAX_SAVE_RETRIES) throw error;
      console.log(`\n第 ${attempt} 次保存撞上版本冲突（后台其他任务同时在写），拉取最新数据重试…`);
    }
  }
}

main().catch(error => {
  console.error('复检失败:', error.message);
  process.exit(1);
});
