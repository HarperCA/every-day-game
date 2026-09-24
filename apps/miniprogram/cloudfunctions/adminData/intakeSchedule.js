// 新抓到的候选，先按时间分档，再决定要不要送 Kimi 三项核验：
//   1. 报名已经截止（有明确日期）—— 直接归档，不进审核队列
//   2. 没公布报名时间 —— 参照库里同名往届的报名时间往后推一年，估算一个
//   3. 有（真实或推算出的）报名时间，且距离现在半年以内 —— 送 Kimi 核验
//   4. 半年以外 —— 先放着，等接近了再核验，别占审核队列
//   5. 找不到时间、也没有往届可参照 —— 交人工，不能瞎猜
const DAY_MS = 24 * 60 * 60 * 1000;
const NEXT_EDITION_OFFSET_MS = 365 * DAY_MS;
const REVIEW_WINDOW_MS = 183 * DAY_MS; // 半年，跟小程序端"距离报名时间"筛选的 6m 口径一致
const STALE_DRAFT_DAYS = 3;

// 剥掉年份、届数这些每年都会变的部分，用来把"2026年全国XX大赛"和
// "第十七届全国XX大赛"对上号。宁可匹配不上（走人工），也不要错配到
// 完全不相关的赛事上去估算日期。
function normalizeCompetitionName(name) {
  return String(name || '')
    .replace(/(19|20)\d{2}\s*[年届]?/g, '')
    .replace(/第?[〇零一二三四五六七八九十百千\d]+\s*届/g, '')
    .replace(/[\s·・.\-—_（）()【】\[\]"“”]/g, '')
    .toLowerCase();
}

// 只在库里已有记录中找"名字对得上、且真的有报名时间（不是别的候选估出来的）"
// 的那一条，作为估算基准——不用估算值去估算下一个估算值，避免误差滚雪球。
function findPriorEdition(record, existingRecords = []) {
  const key = normalizeCompetitionName(record?.name);
  if (!key) return null;
  let best = null;
  for (const candidate of existingRecords) {
    if (candidate?.id === record?.id) continue;
    const base = candidate?.schedule?.registration_start || candidate?.schedule?.competition_start;
    if (!base || candidate?.scheduleEstimated) continue;
    if (normalizeCompetitionName(candidate?.name) !== key) continue;
    const time = Date.parse(base);
    if (!Number.isFinite(time)) continue;
    if (!best || time > Date.parse(best.schedule.registration_start || best.schedule.competition_start)) best = candidate;
  }
  return best;
}

function estimateRegistrationStart(priorRecord) {
  const base = priorRecord?.schedule?.registration_start || priorRecord?.schedule?.competition_start;
  if (!base) return null;
  const time = Date.parse(base);
  if (!Number.isFinite(time)) return null;
  return new Date(time + NEXT_EDITION_OFFSET_MS).toISOString();
}

// record 是 candidateToRecord() 产出的草稿；existingRecords 是库里现有全部记录
// （用于找往届）。返回值只描述"该怎么办"，不做任何写入。
function classifyIntake(record, existingRecords = [], now = new Date()) {
  const end = record?.schedule?.registration_end;
  if (end) {
    const endTime = Date.parse(end);
    if (Number.isFinite(endTime) && endTime < now.getTime()) {
      const prior = findPriorEdition(record, existingRecords);
      return { decision:'archive', reason:'发现时报名已截止', nextEditionEstimate:estimateRegistrationStart(prior) };
    }
  }

  let start = record?.schedule?.registration_start || null;
  let estimated = false;
  if (!start) {
    const prior = findPriorEdition(record, existingRecords);
    const estimate = prior ? estimateRegistrationStart(prior) : null;
    if (estimate) { start = estimate; estimated = true; }
  }
  // 没有日期、也没有往届可参照——这不再是拦发布的理由：不是一定要有报名
  // 时间，只要知道有这场比赛、即将报名就够了。交给三项核验去判断，Kimi
  // 在正文里能读到日期就用，读不到就落回"时间待公布"（not_specified，
  // 见 applyFieldVerification），照常发布，不用在这一步先卡住等人工。
  if (!start) return { decision:'kimi_review', reason:'未公布报名时间、也没有往届可参照，交给三项核验判断', estimatedRegistrationStart:null };

  const startTime = Date.parse(start);
  if (!Number.isFinite(startTime)) return { decision:'manual_review', reason:'报名时间格式无法解析' };

  if (startTime - now.getTime() <= REVIEW_WINDOW_MS) {
    return { decision:'kimi_review', reason:estimated ? '按往届推算的报名时间已进入半年窗口' : '报名时间已进入半年窗口', estimatedRegistrationStart:estimated ? start : null };
  }
  return { decision:'hold', reason:'距离报名时间还有半年以上，暂不进入审核队列', estimatedRegistrationStart:estimated ? start : null };
}

// 3天超时兜底：不管草稿是怎么卡住的（Kimi核验没全过、没日期又没往届、
// 核验调用失败……），只要超过这个天数还没变成"已发布"或"已归档"，就该让人看一眼，
// 而不是无限期躺在待人工审核里没人知道原因。
//
// "hold"（半年以外，故意先放着）不算卡住——那是设计上就要等的，
// ingest-candidates.mjs 会给这类草稿打 stalenessExempt，这里据此跳过，
// 否则每天都会被错误地报"超时"。
//
// firstSeenAt 缺失的老记录（这个字段是今天才加的）不强行判定，避免把
// 迁移前就存在、从没被这套新流程处理过的草稿一律误报成"超时"。
function draftStalenessReason(record) {
  const verification = record?.aiFieldVerification;
  if (verification && verification.all_correct === false) {
    const bits = [];
    if (verification.name_correct === false) bits.push('名称与来源不符');
    if (verification.registration_start_status === 'incorrect') bits.push('报名开始时间与来源不符');
    if (verification.registration_end_status === 'incorrect') bits.push('报名截止时间与来源不符');
    if (verification.registration_url_correct === false) bits.push('报名链接与来源不符');
    if (verification.professions_confident === false) bits.push('无法确定适合专业');
    return `Kimi三项核验未全部通过：${bits.join('、') || '详见核验记录'}`;
  }
  const issues = Array.isArray(record?.qualityIssues) ? record.qualityIssues : [];
  if (issues.length) return issues[issues.length - 1];
  return '超过3天仍未自动发布或归档，原因不明，需人工判断';
}

function evaluateDraftStaleness(record, now = new Date()) {
  if (!record || record.dataStatus !== 'draft') return { stale:false };
  if (record.stalenessExempt) return { stale:false };
  const seenAt = Date.parse(record?.firstSeenAt || '');
  if (!Number.isFinite(seenAt)) return { stale:false };
  if (now.getTime() - seenAt < STALE_DRAFT_DAYS * DAY_MS) return { stale:false };
  return { stale:true, reason:draftStalenessReason(record) };
}

// 把三项核验结果套到一条刚发现的草稿上。三项全过、或者不对的项 Kimi 都
// 给出了能用的修正值——两种情况都视为"资料已经对齐来源"，专业判断有把握
// 就自动发布（比照人工通过时的做法，把来源标记为已核验有效，否则发布闸
// 过不了）。有任何一项既不对、Kimi 又给不出修正值，或者专业判断没把握，
// 才留在草稿。
//
// 跟已发布赛事周检用的自动改法（index.js 的 applyPublishedFieldCorrections）
// 是对称的：那边治"已经发布、数据漂移了"，这边治"刚发现、数据一开始就不
// 齐"，改的方式该是一样的，不能只给已发布的记录用上自动改。
//
// record：candidateToRecord() 产出的草稿。verification：runFieldVerification()
// 的结果。纯函数，不做任何网络调用，方便单测。
function applyFieldVerification(record, verification, now) {
  const timestamp = now.toISOString();
  const corrected = { ...record, schedule:{ ...record.schedule }, sources:[...record.sources] };
  const notes = [];
  let unresolved = false;

  if (!verification.name_correct) {
    if (verification.name_correction) { corrected.name = verification.name_correction.slice(0, 200); notes.push(`Kimi核验自动改名为「${corrected.name}」`); }
    else { notes.push('Kimi核验：名称疑有误，且给不出修正值'); unresolved = true; }
  }
  // not_specified：来源压根没提这个日期——不是记录错了，是官方还没公布。
  // 直接清空对应日期，让它落回"时间待公布"这个本来就存在的合法状态，
  // 不能当成阻断项——用户要的就是"不知道具体时间也能先发布，让学生
  // 知道有这场比赛、即将报名"。
  if (verification.registration_start_status === 'not_specified') {
    corrected.schedule.registration_start = null;
    notes.push('来源未提及报名开始时间，标记为时间待公布');
  } else if (verification.registration_start_status === 'incorrect') {
    const ok = verification.registration_start_correction && !Number.isNaN(Date.parse(verification.registration_start_correction));
    if (ok) { corrected.schedule.registration_start = new Date(verification.registration_start_correction).toISOString(); notes.push(`Kimi核验自动更新报名开始时间为 ${verification.registration_start_correction}`); }
    else { notes.push('Kimi核验：报名开始时间疑有误，且给不出修正值'); unresolved = true; }
  }
  if (verification.registration_end_status === 'not_specified') {
    corrected.schedule.registration_end = null;
    notes.push('来源未提及报名截止时间，标记为时间待公布');
  } else if (verification.registration_end_status === 'incorrect') {
    const ok = verification.registration_end_correction && !Number.isNaN(Date.parse(verification.registration_end_correction));
    if (ok) { corrected.schedule.registration_end = new Date(verification.registration_end_correction).toISOString(); notes.push(`Kimi核验自动更新报名截止时间为 ${verification.registration_end_correction}`); }
    else { notes.push('Kimi核验：报名截止时间疑有误，且给不出修正值'); unresolved = true; }
  }
  // 没有截止时间就是"时间待公布"这条状态位的口径（candidateToRecord.js
  // 建草稿时就是这么定的），这里改完日期要重新对齐一次，不能留着旧值。
  corrected.schedule.pending_announcement = !corrected.schedule.registration_end;
  if (!verification.registration_url_correct) {
    const ok = verification.registration_url_correction && /^https?:\/\//i.test(verification.registration_url_correction);
    if (ok) {
      corrected.registrationUrl = verification.registration_url_correction;
      corrected.sources = corrected.sources.map((source, index) => index === 0 ? { ...source, url:verification.registration_url_correction } : source);
      notes.push('Kimi核验自动更新了报名链接');
    } else { notes.push('Kimi核验：链接疑有误，且给不出修正值'); unresolved = true; }
  }
  if (!verification.professions_confident || !verification.professions.length) {
    notes.push('Kimi核验：无法确定适合专业，需人工判断');
    unresolved = true;
  } else {
    // 即使名称、日期或链接仍待人工修正，可信的专业判断也应保留在草稿中。
    corrected.professions = verification.professions;
  }

  if (!unresolved) {
    return {
      ...corrected,
      dataStatus:'published',
      systemValidation:'passed',
      manualReview:'passed',
      manualReviewReason:`Kimi三项核验通过（名称/报名时间/链接，${notes.length ? '含自动修正' : '原始资料即一致'}），系统自动发布`,
      professions:corrected.professions,
      publishedAt:timestamp,
      updatedAt:timestamp,
      updatedBy:'kimi-intake-review',
      aiFieldVerification:verification,
      sources:corrected.sources.map(source => ['discovery_notice','university_notice','search_candidate'].includes(source.source_type)
        ? source : { ...source, is_official:true, validity_status:'valid', last_verified_at:timestamp }),
    };
  }
  return {
    ...corrected,
    qualityIssues:[...record.qualityIssues, ...notes],
    aiFieldVerification:verification,
    updatedAt:timestamp,
  };
}

module.exports = {
  REVIEW_WINDOW_MS, NEXT_EDITION_OFFSET_MS, STALE_DRAFT_DAYS,
  normalizeCompetitionName, findPriorEdition, estimateRegistrationStart, classifyIntake,
  draftStalenessReason, evaluateDraftStaleness, applyFieldVerification,
};
