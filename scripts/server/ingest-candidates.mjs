// 把抓取候选写入后台。水赛过滤器判定为 admit 的候选，按报名时间分档
// 自动处理；判定为 review 的，先送 AI（DeepSeek）再判断一次——关键词正则
// 只认"教育部""XX学会"这几种措辞，知名企业/技术平台主办、真有实质投入的
// 赛事总会漏判，AI 有信心判定"有收录价值"的才升级成 admit，继续走三项核验；
// 没把握的仍然按原判定进草稿，等人工看。
//
// 走的是后台本来就有的 saveRecords：它带乐观锁（expectedVersion）和审计，
// 并且在同一个事务里同步公开缓存 —— 只有 published/archived 的记录才会进
// 缓存。不另起一条写入路径。
//
// admit 候选的分档规则（见 intakeSchedule.js）：
//   1. 发现时报名已截止 —— 直接归档，不进审核队列
//   2. 没公布报名时间 —— 按库里同名往届的报名时间推算一个
//   3. （真实或推算的）报名时间半年以内 —— 送三项核验（名称/报名时间/链接），
//      三项都对且专业分类判断得有把握 —— 自动发布；否则转人工
//   4. 半年以外 —— 先放草稿，不占审核队列，等接近了下次重跑再核验
//   5. 没有时间信息、也找不到往届参照 —— 转人工
//
// 三条纪律不变：
//   1. 没被自动发布/归档的，一律 draft，manualReview=pending。
//   2. 按 id 去重。重跑只更新既有草稿，不会产生第二条。
//   3. 已经人工或系统动过的记录（manualReview 不再是 pending，或 dataStatus
//      不再是 draft）一律跳过 —— 抓取不能覆盖已经做过的判断。
//
// 用法：node ingest-candidates.mjs --candidates x.json --extracted y.json [--dry-run] [--only-admitted]
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { extractChannelEntries, mergeDiscoveredChannels } from './crawler/lib/discoveredChannels.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CJS_DIR = path.join(HERE, 'cjs');
const TOKEN_FILE = path.join(HERE, '.admin-token');
const AI_KEY_FILE = path.join(HERE, '.ai-key');
const EXTRACT_AI_KEY_FILE = path.join(HERE, '.extract-key');
// 后端已迁到自有服务器（见 docs/migration-to-self-hosted.md）。走本机 /api，
// 不走公网也不走 CloudBase——这两个脚本本来就只在服务器本地跑。
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8787';
const KIMI_CALL_DELAY_MS = 1200;
const ADMISSION_JUDGMENT_DELAY_MS = 600;

// 跟正式 API 服务（daily-contest-api.service）当前实际配置的供应商保持一致——
// 那边"运行Kimi审核"用的是 .ai-key + kimi-for-coding，这里不能各用各的。
function primeAiEnv() {
  if (!fs.existsSync(AI_KEY_FILE)) return false;
  const key = fs.readFileSync(AI_KEY_FILE, 'utf8').trim();
  if (!key) return false;
  process.env.AI_API_KEY = process.env.AI_API_KEY || key;
  process.env.AI_BASE_URL = process.env.AI_BASE_URL || 'https://api.kimi.com/coding/v1';
  process.env.AI_MODEL = process.env.AI_MODEL || 'kimi-for-coding';
  return true;
}
const aiConfigured = primeAiEnv();

// review 档的二次判断走 EXTRACT_ 前缀配置，跟批量抽取共用 .extract-key——
// 这是突发型负载（一天上百条），按量计费的 DeepSeek 比 Kimi 会员制窗口
// 配额更合适，也不占审核那条线的额度。
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

const require = createRequire(import.meta.url);
const { candidateToRecord, withVerifiedName } = require(path.join(CJS_DIR, 'candidateToRecord.js'));
const { blockedTitleReason, isNoticeTitle, isNonEventTitle } = require(path.join(CJS_DIR, 'noticeResolution.js'));
const { isClearlyOutOfScope, classifyCompetitionScope, assessIntakeRecord } = require(path.join(CJS_DIR, 'competitionScope.js'));
const { assessAdmission } = require(path.join(CJS_DIR, 'competitionAdmission.js'));
const { judgeAdmissionWithAi } = require(path.join(CJS_DIR, 'competitionAdmissionAi.js'));
const { classifyIntake, applyFieldVerification } = require(path.join(CJS_DIR, 'intakeSchedule.js'));
const { runFieldVerification, PROFESSION_TAXONOMY } = require(path.join(CJS_DIR, 'competitionAiReview.js'));
const { buildReasoningDoc, thinkingEnabled } = require(path.join(CJS_DIR, 'aiReasoning.js'));

// 本次运行里 AI 的思考过程（2026-09-30 测试阶段：所有模型的思考都打开并记录，见 cjs/aiReasoning.js）。
// 运行结束时写进运行目录的 ai-reasoning.json，并经后台 saveAiReasoning 存进 ai_reasoning，
// 后台“审核发布”里按赛事可以查看。rescore-review-drafts.mjs 也复用这里。
export const reasoningLog = [];
export const logReasoning = (record, extra = {}) => entry => reasoningLog.push(buildReasoningDoc({
  ...entry, recordId:record?.id || null, recordName:record?.name || '', extra:{ ...extra, ...(entry.extra || {}) },
}));

// 把攒下的思考过程落文件、写库（dry-run 只落文件）。清空后可重复调用。
export async function flushReasoning(call, { dryRun = false, file = '' } = {}) {
  const docs = reasoningLog.splice(0, reasoningLog.length);
  if (!docs.length) return 0;
  if (file) fs.writeFileSync(file, JSON.stringify({ createdAt:new Date().toISOString(), dryRun, entries:docs }, null, 2));
  if (dryRun) { console.log(`AI 思考过程 ${docs.length} 条：只写了文件（dry-run）${file ? '：' + file : ''}`); return 0; }
  let saved = 0;
  for (let i = 0; i < docs.length; i += 100) {
    try { saved += (await call({ action:'saveAiReasoning', docs:docs.slice(i, i + 100) }))?.saved || 0; }
    catch (error) { console.log(`AI 思考过程写库失败：${String(error?.message || error).slice(0, 160)}`); }
  }
  console.log(`AI 思考过程：${docs.length} 条，写库 ${saved} 条${file ? '，文件：' + file : ''}`);
  return saved;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fillDraftProfessions(record) {
  if (record.professions?.length) return record;
  if (!aiConfigured) {
    record.qualityIssues.push('专业分类待 Kimi 判断：服务器未配置审核密钥');
    return record;
  }
  try {
    const verification = await runFieldVerification(record, undefined, { chatTimeoutMs:180000, maxTokens:8000, onReasoning:logReasoning(record, { stage:'草稿专业分类' }) });
    const readable = verification.evidence_status?.some(item => item.status === 'reachable' && item.chars > 100);
    const validProfessions = (verification.professions || []).filter(item => PROFESSION_TAXONOMY.includes(item));
    record.aiProfessionClassification = {
      professions:readable && verification.professions_confident ? validProfessions : [],
      confident:Boolean(readable && verification.professions_confident && validProfessions.length),
      evidence_status:verification.evidence_status || [],
      model:verification.model,
      reviewed_at:verification.reviewed_at,
    };
    if (readable && verification.professions_confident && validProfessions.length) {
      record.professions = [...new Set(validProfessions)].slice(0, 5);
      record.qualityIssues.push(`Kimi根据来源建议专业分类：${record.professions.join('、')}（草稿待复核）`);
    } else {
      record.qualityIssues.push('Kimi未能依据可读来源确定专业分类，草稿保留待人工复核');
    }
  } catch (error) {
    record.qualityIssues.push(`Kimi专业分类调用失败，草稿待复核：${String(error?.message || error).slice(0, 120)}`);
  } finally {
    await sleep(KIMI_CALL_DELAY_MS);
  }
  return record;
}

// admit 候选的时间分档 + 核验入口。verdict !== 'admit' 的候选不调用这个函数，
// 维持原来的"一律草稿"。
async function applyIntakeDecision(record, existingRecords, now = new Date()) {
  const classification = classifyIntake(record, existingRecords, now);
  if (classification.decision === 'archive') {
    return {
      record:{
        ...record,
        dataStatus:'archived',
        archivedAt:now.toISOString(),
        archivedReason:'discovered_already_closed',
        // 下一届的粗估（intakeSchedule.js 的 estimateNextEditionFromClosed），只给管理员参考
        nextEditionEstimate:classification.nextEditionEstimate || null,
        nextEditionEndEstimate:classification.nextEditionEndEstimate || null,
        nextEditionBasis:classification.nextEditionBasis || '',
        qualityIssues:[...record.qualityIssues, `发现时报名已截止，已归档；下一届估算：${classification.nextEditionBasis || '无法估算'}`],
      },
      label:'archive',
    };
  }
  if (classification.decision === 'hold' || classification.decision === 'manual_review') {
    return {
      // hold 是故意先放着（报名时间还早），要豁免 3 天超时提醒；
      // manual_review 没有时间信息、需要人判断，不豁免——3天没人处理就该报出来。
      record:{ ...record, qualityIssues:[...record.qualityIssues, classification.reason], stalenessExempt:classification.decision === 'hold' },
      label:classification.decision === 'hold' ? 'hold' : 'review',
    };
  }
  // kimi_review
  if (classification.estimatedRegistrationStart) {
    record = { ...record, schedule:{ ...record.schedule, registration_start:classification.estimatedRegistrationStart }, scheduleEstimated:true };
  }
  if (!aiConfigured) {
    return { record:{ ...record, qualityIssues:[...record.qualityIssues, '进入半年审核窗口，但服务器未配置 AI 密钥，暂转人工'] }, label:'review' };
  }
  try {
    const verification = await runFieldVerification(record, undefined, { chatTimeoutMs:180000, maxTokens:8000, onReasoning:logReasoning(record, { stage:'入库三项核验' }) });
    const readable = verification.evidence_status?.some(item => item.status === 'reachable' && item.chars > 100);
    const supported = (verification.professions || []).filter(item => PROFESSION_TAXONOMY.includes(item));
    const safeVerification = readable ? { ...verification, professions:supported } : {
      ...verification, professions:[], professions_confident:false,
      summary:`来源正文不可读，不能据此填写专业分类或自动发布；${verification.summary}`,
    };
    let updated = applyFieldVerification(record, safeVerification, now);
    // 2026-09-30 起测试：AI 思考全部打开，自动发布照常，但在后台“审核发布”的发布状态旁留一条备注，
    // 提醒人工点“AI思考过程”核对。只给后台看，公开缓存是字段白名单，小程序端看不到。
    if (updated.dataStatus === 'published' && thinkingEnabled()) {
      updated = { ...updated, aiAutoPublishNote:`AI 思考测试期间自动发布（${now.toISOString().slice(0, 10)}）：三项核验由 Kimi 完成，请点“AI思考过程”核对依据` };
    }
    return { record:updated, label:updated.dataStatus === 'published' ? 'auto-publish' : 'review' };
  } catch (error) {
    return {
      record:{ ...record, qualityIssues:[...record.qualityIssues, `三项核验调用失败（${String(error?.message || error).slice(0, 120)}），转人工`] },
      label:'review',
    };
  } finally {
    await sleep(KIMI_CALL_DELAY_MS);
  }
}

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
    organizer:extraction.extracted?.organizer?.value || candidate.organizer,
    participants:extraction.extracted?.participants?.value || candidate.participants || '',
    eligibility:extraction.extracted?.eligibility?.value || candidate.eligibility || '',
    formatAndRules:extraction.extracted?.format_and_rules?.value || candidate.formatAndRules || '',
    authority_signals:extraction.extracted?.authority_signals || [],
    reward_highlights:(extraction.extracted?.reward_highlights || []).map(item => item.value),
    recognition:(extraction.extracted?.recognition_hints || []).map(hint => ({
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
  const scopeHeld = [];
  const admittedCandidates = []; // 用于"可复用信源资产"：只记真正收录的那些来自哪个网站
  let eligibleDiscovered = 0;

  const now = new Date();
  for (const rawCandidate of candidates) {
    const extraction = extractions.find(item => item.url === rawCandidate.detailUrl);
    const candidate = withVerifiedName(rawCandidate, extraction);
    // 标题命中「通知」仅能留在抓取报告作追溯线索，不能进入赛事库。
    const titleBlock = blockedTitleReason(candidate.name) || blockedTitleReason(candidate.seriesName);
    if (titleBlock || isNoticeTitle(candidate.name) || isNoticeTitle(candidate.seriesName)) {
      skipped.push([candidate.name, titleBlock || '通知或公告标题仅作发现线索，不予入库']);
      continue;
    }
    const merged = withExtraction(candidate, extraction);
    // 百度只给标题、网址和正文片段；资格等字段必须等详情页抽取完成后
    // 再判断。先检查候选会把有正文证据的比赛当成“缺少资格”误拦。
    const scope = classifyCompetitionScope(merged);
    if (scope.decision !== 'eligible') {
      skipped.push([candidate.name, scope.reason]);
      scopeHeld.push({ candidate, scope, extraction, processedAt:now.toISOString() });
      continue;
    }
    if (isClearlyOutOfScope(merged) || isNonEventTitle(candidate.name) || isNoticeTitle(candidate.name)) {
      skipped.push([candidate.name, '非独立大学生专业赛事，不予入库']);
      continue;
    }
    let record = candidateToRecord(candidate, extraction);
    const intake = assessIntakeRecord(record);
    if (intake.decision !== 'eligible') {
      skipped.push([candidate.name, intake.reason]);
      scopeHeld.push({candidate, scope:intake, extraction, processedAt:now.toISOString()});
      continue;
    }
    let verdict = assessAdmission(merged).verdict;
    if (verdict === 'out_of_scope' || verdict === 'reject') { skipped.push([candidate.name, `门槛 ${verdict}`]); continue; }
    eligibleDiscovered += 1;

    // review 档不再一律停等人工：关键词打分够不到门槛的，送 AI 在草稿真正
    // 写入之前、Kimi 三项核验之前再读一遍资料判断一次，比正则关键词更懂
    // "这个主办方靠不靠谱"这种需要理解上下文的事。红旗直接拒收的不会走
    // 到这里——那些信号本身可靠，不需要用主观判断去"求情"。
    let admissionJudgment = null;
    if (verdict === 'review' && extractAiConfigured) {
      try {
        admissionJudgment = await judgeAdmissionWithAi(merged, undefined, { onReasoning:logReasoning(record, { stage:'收录判断' }) });
        if (admissionJudgment.worth_including && admissionJudgment.confident) verdict = 'admit';
      } catch (error) {
        admissionJudgment = { error:String(error?.message || error).slice(0, 200) };
      } finally {
        await sleep(ADMISSION_JUDGMENT_DELAY_MS);
      }
    }

    if (args.onlyAdmitted && verdict !== 'admit') { skipped.push([candidate.name, `门槛 ${verdict}`]); continue; }

    // admit 档稍后在 applyIntakeDecision 中进行 Kimi 三项核验并填写专业。
    // review 档不会自动发布，但也要请 Kimi 根据可读来源填写专业分类。
    if (verdict === 'review') record = await fillDraftProfessions(record);

    // candidateToRecord 每次都从零构造，firstSeenAt 要么继承自已有草稿、
    // 要么这是它第一次真正入库——3天超时判断就靠这个字段撑住，绝不能
    // 每次重跑都被重置，否则一条老草稿会永远显示"刚发现"。
    record.firstSeenAt = byId.get(record.id)?.firstSeenAt || now.toISOString();
    // 来源链同理：记的是第一次把它带进来的路线和查询词。
    record.discovery = byId.get(record.id)?.discovery || record.discovery || null;
    // 存下当时的门槛判定，rescore-review-drafts.mjs 靠这个字段找出"当初判成
    // review、后来数据补全了却从没重新算过分"的草稿，不用去猜哪些该重新算。
    record.admissionVerdict = verdict;
    if (admissionJudgment) {
      record.qualityIssues = [...record.qualityIssues, admissionJudgment.error
        ? `AI收录判断调用失败（${admissionJudgment.error}）`
        : `AI收录判断：${admissionJudgment.worth_including ? '认为有收录价值' : '认为价值不足'}（${admissionJudgment.confident ? '有把握' : '没把握，仍按原判定处理'}）｜${admissionJudgment.reason}`];
    }
    const current = byId.get(record.id);
    if (current && (current.manualReview !== 'pending' || current.dataStatus !== 'draft')) {
      // 人已经动过、或已经被自动发布/归档过的记录，抓取不能覆盖
      skipped.push([candidate.name, `已处理（${current.dataStatus}/${current.manualReview}）`]);
      continue;
    }

    let label = verdict;
    if (verdict === 'admit') {
      const outcome = await applyIntakeDecision(record, next, now);
      record = outcome.record;
      label = outcome.label;
      // 2026-09-30 起：发现时已截止、但其余都符合要求的，不再丢弃，收进库里作为已归档，并估算下一届。
      // 归档记录没经过人工审核，公开缓存不会收它（要求系统验证和人工审核都通过），小程序看不到。
      if (label === 'archive') record = await fillDraftProfessions(record);
      if (['hold','review'].includes(label) && !record.aiFieldVerification
        && !record.qualityIssues.some(issue => issue.startsWith('三项核验调用失败'))) {
        record = await fillDraftProfessions(record);
      }
    }

    if (!current) {
      next.push(record);
      added.push([candidate.name, label, verdict]);
      admittedCandidates.push(candidate);
      continue;
    }
    next[next.indexOf(current)] = record;
    updated.push([candidate.name, label]);
    admittedCandidates.push(candidate);
  }

  console.log(`\n新增 ${added.length}｜更新草稿 ${updated.length}｜跳过 ${skipped.length}`);
  const scopeReport = path.resolve(HERE, args.candidates) + '.scope-review.json';
  await fsp.writeFile(scopeReport, JSON.stringify({ createdAt:now.toISOString(), held:scopeHeld }, null, 2));
  console.log(`范围未通过 ${scopeHeld.length} 条，线索报告：${scopeReport}`);
  for (const [name, why] of added) console.log(`  + ${why.padEnd(7)} ${name.slice(0, 34)}`);
  for (const [name, why] of updated) console.log(`  ~ ${why.padEnd(7)} ${name.slice(0, 34)}`);
  for (const [name, why] of skipped) console.log(`  - ${String(why).padEnd(24)} ${name.slice(0, 30)}`);

  const reportFile = path.join(path.dirname(path.resolve(HERE, args.candidates)), 'ingest-report.json');
  await flushReasoning(call, { dryRun:args.dryRun, file:path.join(path.dirname(path.resolve(HERE, args.candidates)), 'ai-reasoning.json') });
  const writeIngestReport = persisted => {
    const failureReasons = {};
    for (const [, reason] of skipped) failureReasons[reason] = (failureReasons[reason] || 0) + 1;
    const coreFields = ['organizer','participants','eligibility','formatAndRules','registrationUrl'];
    const enrichedRecords = next.filter(record => {
      const previous = byId.get(record.id);
      return previous && previous !== record
        && (coreFields.some(field => !String(previous[field] || '').trim() && String(record[field] || '').trim())
          || (record.sources || []).some(source => source.is_official && source.validity_status === 'valid'
            && !(previous.sources || []).some(old => old.url === source.url && old.is_official && old.validity_status === 'valid')));
    });
    fs.writeFileSync(reportFile, JSON.stringify({
      generatedAt:new Date().toISOString(), persisted, dryRun:args.dryRun,
      eligibleDiscovered, added:persisted ? added.length : null,
      qualifiedNew:persisted ? added.filter(([, , verdict]) => verdict === 'admit').length : null,
      publishedNew:persisted ? added.filter(([, label]) => label === 'auto-publish').length : null,
      publishedExisting:persisted ? updated.filter(([, label]) => label === 'auto-publish').length : null,
      updated:persisted ? updated.length : null,
      enriched:persisted ? enrichedRecords.length : null,
      enrichedIds:persisted ? enrichedRecords.map(record => record.id) : [],
      skipped:skipped.length, failureReasons,
      addedIds:persisted ? next.filter(record => !byId.has(record.id)).map(record => record.id) : [],
      publishedIds:persisted ? next.filter(record => record.dataStatus === 'published' &&
        (!byId.has(record.id) || byId.get(record.id).dataStatus !== 'published')).map(record => record.id) : [],
      updatedIds:persisted ? next.filter(record => byId.has(record.id) && byId.get(record.id) !== record).map(record => record.id) : [],
    }, null, 2));
  };

  if (args.dryRun) { writeIngestReport(false); console.log('\n--dry-run：未写入。'); return; }
  if (!added.length && !updated.length) { writeIngestReport(true); console.log('\n没有需要写入的内容。'); return; }

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
  writeIngestReport(true);
  console.log(`\n已写入：${result.saved} 条，version ${version} → ${result.version}`);
  console.log(`公开缓存：发布 ${result.publicCachePublished ?? 0}，移除 ${result.publicCacheRemoved ?? 0}（草稿不进缓存）`);

  // 可复用信源资产：把这轮收录背后的网站域名（去掉天池/DataFountain 这类
  // 已知聚合平台）攒进去，供下次抓取参考"这类通知常出现在哪"。
  const entries = extractChannelEntries(admittedCandidates.map(c => ({ url:c.detailUrl, name:c.name, query:c.matchedQuery })));
  if (entries.length) {
    if (args.dryRun) {
      console.log(`\n（dry-run，跳过写入 ${new Set(entries.map(e => e.host)).size} 个信源域名）`);
    } else {
      const existingChannels = await call({ action:'listDiscoveredChannels' });
      const mergedChannels = mergeDiscoveredChannels(existingChannels, entries);
      const channelResult = await call({ action:'saveDiscoveredChannels', channels:mergedChannels });
      console.log(`信源资产：本轮新增/更新 ${new Set(entries.map(e => e.host)).size} 个域名，累计 ${channelResult.saved} 个`);
    }
  }
}

// 只有直接执行这个文件（node ingest-candidates.mjs）才跑 main；被
// rescore-review-drafts.mjs 当模块 import 复用 applyIntakeDecision 时，
// 不能因为 import 就把这整套抓取入库流程也带着跑起来。
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('入库失败:', error.message);
    process.exit(1);
  });
}

export { applyIntakeDecision, applyFieldVerification, aiConfigured };
