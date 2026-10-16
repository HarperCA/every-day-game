const { runKimiResolutionAgent } = require('./kimiResolutionAgent');
const { runFieldVerification } = require('./competitionAiReview');
const { assessIntakeRecord } = require('./competitionScope');
const { registrationInstant, registrationScheduleIssues, unresolvedRegistrationQualityIssues } = require('./registrationSchedule');
const { requirePublishGate, toPublicCache } = require('./publicCache');

const FILTER_RULES = {
  eventLevel:{ values:['国际级','国家级','省级/区域级','其他/未明确'], fallback:'其他/未明确' },
  participationFormat:{ values:['个人赛','团队赛','个人或团队均可','暂未明确'], fallback:'暂未明确', original:'teamSize' },
  teamSizeCategory:{ values:['1人','2～3人','4～5人','6人及以上','人数范围不固定','暂未明确'], fallback:'暂未明确', original:'teamSize' },
  feeType:{ values:['免费','收费','不同赛项费用不同','暂未公布'], fallback:'暂未公布', original:'fees' },
  registrationOrganization:{ values:['自行报名','学校统一报名','两种方式均可','需先校内选拔','以赛区或学校通知为准','暂未明确'], fallback:'暂未明确', original:'registrationMethod' },
};

function mappingMeaningMatches(field, value, original) {
  if (field === 'eventLevel') return value === '国际级' ? /国际|全球|世界/.test(original)
    : value === '国家级' ? /全国|国家级/.test(original) : /省|自治区|直辖市|区域|赛区/.test(original);
  if (field === 'participationFormat') {
    const individual = /个人|单人|1\s*人/.test(original), team = /团队|队伍|组队|[2-9二三四五六七八九十]\s*人/.test(original);
    return value === '个人赛' ? individual && !team : value === '团队赛' ? team && !individual : individual && team;
  }
  if (field === 'teamSizeCategory') {
    if (value === '人数范围不固定') return /不限|不限定|不限制|不固定|自行确定/.test(original);
    const numbers = [...original.matchAll(/(\d+)\s*(?=[～~—至到-]|人|名)/g)].map(match => Number(match[1]));
    if (!numbers.length) return false;
    const bounds = value === '1人' ? [1,1] : value === '2～3人' ? [2,3] : value === '4～5人' ? [4,5] : [6,Infinity];
    return numbers.every(number => number >= bounds[0] && number <= bounds[1]);
  }
  if (field === 'feeType') {
    const free = /免费|不收取|不收费|免收/.test(original);
    return value === '免费' ? free : value === '不同赛项费用不同' ? /赛项|赛道|不同/.test(original) && /收费|费用|元/.test(original) : !free && /收费|收取|费用.*\d|\d+\s*元/.test(original);
  }
  if (field === 'registrationOrganization') {
    const self = /自行|自主|个人.*报名|参赛者.*报名/.test(original), school = /学校.*统一|高校.*统一|统一.*报名|学校.*推荐/.test(original);
    return value === '自行报名' ? self && !school : value === '学校统一报名' ? school && !self : value === '两种方式均可' ? self && school : value === '需先校内选拔' ? /校内.*选拔|学校.*选拔|校赛/.test(original) : /赛区|学校.*通知/.test(original);
  }
  return false;
}

function normalizeFilterMappings(candidate, agentResult) {
  const changes = [];
  const normalize = text => String(text || '').replace(/\s+/g,' ' ).trim();
  const officialUrls = new Set(candidate.sources.filter(source => source.is_official && source.validity_status === 'valid').map(source => source.url));
  const officialText = (agentResult.evidence || []).filter(item => officialUrls.has(item.url) && item.status === 'reachable').map(item => normalize(item.text));
  for (const [field, rule] of Object.entries(FILTER_RULES)) {
    const value = candidate[field];
    let supported = rule.values.includes(value);
    if (supported && value !== rule.fallback) {
      if (rule.original) {
        const original = normalize(candidate[rule.original]);
        supported = Boolean(original && officialText.some(text => text.includes(original)) && mappingMeaningMatches(field, value, original));
      } else {
        // No separate level-original field exists; retain its verbatim supporting excerpt.
        supported = candidate.sources.some(source => officialUrls.has(source.url)
          && (source.supports_fields || []).some(key => /eventLevel|event_level|赛事级别/.test(key))
          && normalize(source.evidence_excerpt) && officialText.some(text => text.includes(normalize(source.evidence_excerpt)))
          && mappingMeaningMatches(field, value, source.evidence_excerpt));
      }
    }
    if (!supported) {
      candidate[field] = rule.fallback;
      changes.push({ field, before:value ?? null, after:rule.fallback, reason:'枚举无效或缺少已读取官方原文，按未明确展示' });
    }
  }
  return changes;
}

// The agent supplies evidence and field corrections; status is decided here.
async function resolveFailedCompetition(record, failedReview, options = {}, deps = {}) {
  const now = new Date(options.now || new Date());
  const at = now.toISOString();
  // 接口用量记账细分到“处置代理”“独立复核”（api-usage.mjs；本地测试没装钩子时直接执行）
  const usageLabel = (label, fn) => globalThis.__apiUsage ? globalThis.__apiUsage.run(label, fn) : fn();
  const agentResult = await usageLabel('处置代理', () => (deps.runAgent || runKimiResolutionAgent)(record, { ...options, failedReview }, deps.agentDeps || {}));
  const remove = reason => ({ outcome:'delete', record:null, reason, agentResult });
  if (agentResult.outcome === 'delete') return remove(agentResult.reason);
  const patch = agentResult.recordPatch || {};
  let candidate = { ...record, ...patch, id:record.id, eventId:record.eventId,
    schedule:{ ...record.schedule, ...patch.schedule }, dataStatus:'published',
    systemValidation:'passed', manualReview:'passed', needsManualReview:false,
    updatedAt:at, updatedBy:'system:kimi-resolution', reviewedAt:at,
  };
  // A date-only announcement must not acquire an invented midnight deadline.
  const timeNote = String(candidate.schedule.time_note || '');
  if (/未(?:明确|公布|给出|说明|注明|标明|提供|列出)(?:具体)?(?:截止)?(?:时间点|时刻|几点|小时)|仅(?:提供|公布|注明|列出)?日期|只有日期|无具体时刻/.test(timeNote)
      && !/明确(?:为|于|写明|公布)?(?:午夜|零点|0点|00:00)|(?:午夜|零点).*截止/.test(timeNote)) {
    for (const field of ['registration_start','registration_end']) {
      const value = candidate.schedule[field];
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T00:00(?::00(?:\.0{1,3})?)?\+08:00$/.test(value)) candidate.schedule[field] = value.slice(0,10);
    }
  }
  candidate.sources = (candidate.sources || []).map((source, index) => ({
    ...source, id:source.id || `source-${record.id}-resolution-${index + 1}`, edition_id:record.id,
    title:source.title || candidate.name, content_summary:source.content_summary || source.evidence_excerpt,
    review_reason:source.review_reason || agentResult.reason,
  }));
  const filterAdjustments = normalizeFilterMappings(candidate, agentResult);
  // Only dated-field pending flags proved resolved by the new sources are cleared.
  candidate.qualityIssues = unresolvedRegistrationQualityIssues(candidate).filter(issue => !/^周检：|^ai_review_/.test(issue));
  const verification = await usageLabel('独立复核', () => (deps.verify || runFieldVerification)(candidate, undefined, {
    chatTimeoutMs:options.chatTimeoutMs, maxTokens:options.maxTokens, onReasoning:options.onReasoning,
  }));
  if (!Array.isArray(verification.evidence_status)) throw new Error('kimi_resolution_independent_evidence_required');
  if (Array.isArray(verification.evidence_status)) {
    const readableOfficial = verification.evidence_status.some(item => item.status === 'reachable' && item.chars > 0 && candidate.sources.some(source => source.url === item.url && source.is_official && source.validity_status === 'valid'));
    if (!readableOfficial) {
      if (verification.evidence_status.some(item => /unreachable|blocked|http_(?:403|429|5)|image|relay_error/.test(item.status || ''))) throw new Error('kimi_resolution_independent_evidence_unavailable');
      throw new Error('kimi_resolution_manual_evidence_required');
    }
  }
  const failures = [];
  if (verification.source_scope !== 'official') failures.push('独立复核未确认赛事官方来源');
  if (verification.name_correct !== true) failures.push('比赛名称未通过独立复核');
  if (verification.registration_url_correct !== true) failures.push('官方报名网址未通过独立复核');
  for (const field of ['registration_start','registration_end']) {
    const status = verification[`${field}_status`];
    if (candidate.schedule[field] ? status !== 'confirmed_correct' : status !== 'not_specified') failures.push(`${field === 'registration_start' ? '报名开始' : '报名截止'}时间未通过独立复核`);
  }
  if (verification.professions_confident !== true || !Array.isArray(verification.professions) || !verification.professions.length) failures.push('专业大类映射未核实');
  // 代理说是真比赛、独立复核却没全过：不删，留成草稿写明哪项没过，等人工处理（2026-10-09 用户定）。
  // 打上 aiResolution.outcome='draft'，定时审核不再反复拿它跑代理，7 天后到期才重审。
  if (failures.length) {
    const reason = `${agentResult.reason}；独立复核未通过，留为草稿待人工确认：${failures.join('；')}`;
    const { aiReviewFailure, fieldVerificationFailure, aiResolutionFailure, ...rest } = candidate;
    return { outcome:'draft', reason, agentResult, record:{ ...rest,
      dataStatus:'draft', manualReview:'pending', needsManualReview:true, fieldVerification:verification,
      qualityIssues:[...new Set([...rest.qualityIssues, ...failures.map(item => `独立复核未通过：${item}`)])],
      aiResolution:{ reviewed_at:at, reason, outcome:'draft', failed_checks:failures, initial_review:failedReview,
        evidence:agentResult.evidence, tool_calls:agentResult.tool_calls, filter_adjustments:filterAdjustments,
        review_method:'user_authorized_agent_and_independent_field_verification' },
    } };
  }
  candidate.professions = verification.professions;
  candidate.fieldVerification = verification;
  candidate.qualityIssues = candidate.qualityIssues.filter(issue => issue !== 'notice_resolution_pending');
  const intake = assessIntakeRecord(candidate);
  if (intake.decision !== 'eligible') return remove(`补查后仍不符合入库要求：${intake.reason}`);
  const scheduleIssues = registrationScheduleIssues(candidate.schedule);
  if (scheduleIssues.length) return remove(`官方时间仍存在问题：${scheduleIssues.join('；')}`);
  const duplicate = (options.records || []).find(item => item.id !== record.id && ['published','archived'].includes(item.dataStatus) && item.name === candidate.name && String(item.editionYear || '') === String(candidate.editionYear || '') && String(item.editionOrdinal || '') === String(candidate.editionOrdinal || ''));
  if (duplicate) return remove(`与已有赛事届次重复：${duplicate.id}`);
  try { requirePublishGate(candidate); toPublicCache(candidate, now); }
  catch (error) { return remove(`补查后发布门槛仍未通过：${error.message}`); }
  const end = registrationInstant(candidate.schedule.registration_end, 'end');
  const outcome = Number.isFinite(end) && end < now.getTime() ? 'archived' : 'published';
  const reason = `${agentResult.reason}；官网、名称、报名时间及专业分类已独立复核${outcome === 'archived' ? '，报名已结束，归档' : '，符合要求，发布'}`;
  candidate = { ...candidate, dataStatus:outcome, aiReview:{ decision:'recommend_approve', summary:reason, reviewed_at:at, evidence_refs:candidate.sources.map(source => source.id) },
    aiResolution:{ reviewed_at:at, reason, outcome, initial_review:failedReview, evidence:agentResult.evidence, tool_calls:agentResult.tool_calls, filter_adjustments:filterAdjustments, review_method:'user_authorized_agent_and_independent_field_verification' },
    ...(outcome === 'archived' ? { archivedAt:at, archivedReason:'registration_closed_after_kimi_resolution' } : {}),
  };
  delete candidate.aiReviewFailure;
  delete candidate.fieldVerificationFailure;
  delete candidate.aiResolutionFailure;
  return { outcome, record:candidate, reason, agentResult };
}

module.exports = { resolveFailedCompetition };
