// 把抓取候选 + 抽取结果转成后台记录。
//
// 三条纪律：
//
// 一、一律以 draft 入库，systemValidation=not_run、manualReview=pending。
//    发布闸（requirePublishGate）因此必然拦住它们 —— 抓来的东西不能绕过人工。
//
// 二、只填有出处的字段。抽取给的每一项都带原文引文，引文进 qualityIssues
//    的待确认清单里，人工复核时能直接看到依据。没有引文的一律不填。
//
// 三、不猜专业分类。天池的标签（机器人、CV、NLP）和库里的十三类专业分类
//    不是一回事，映射是判断不是事实，留空让人来定 —— 而且 professions
//    为空时公开缓存本来就会拒绝发布，正好形成一道自然的提醒。
const { deriveRewardTier, deriveScaleTier, normalizeRecognition } = require('./competitionValue');

const ID_SAFE = /[^A-Za-z0-9_-]/g;

// 外部来源的 id 可能带任意字符，做成库内 id 前必须收敛到安全字符集。
function toSafeId(prefix, externalId) {
  const tail = String(externalId || '').replace(ID_SAFE, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  if (!tail) throw new Error('invalid_candidate_external_id');
  return `${prefix}-${tail}`;
}

function firstQuote(items, value) {
  const hit = (items || []).find(item => item && item.value === value);
  return hit ? String(hit.quote || '') : '';
}

// 把抽取到的、带引文的事实整理成人工复核时看得见的待确认清单。
function buildReviewNotes(candidate, extracted) {
  const notes = [];
  if (extracted?.organizer) notes.push(`主办方待确认：${extracted.organizer.value}｜依据：${extracted.organizer.quote}`);
  for (const signal of extracted?.authority_signals || []) {
    notes.push(`权威性线索：${signal.signal}｜依据：${signal.quote}`);
  }
  for (const item of extracted?.reward_highlights || []) {
    notes.push(`回报「${item.value}」｜依据：${item.quote}`);
  }
  for (const hint of extracted?.recognition_hints || []) {
    // 等级是判断不是事实，必须由人确认
    notes.push(`认可度建议（待人工确认）：${hint.path}／${hint.level}｜依据：${hint.quote}`);
  }
  for (const missing of extracted?.missing || []) notes.push(`原文未写明：${missing}`);
  if (!candidate.professions?.length) notes.push(`专业分类待人工判定；来源标签：${(candidate.tags || []).join('、') || '无'}`);
  return notes.slice(0, 40);
}

function candidateToRecord(candidate, extractionResult, { now = new Date() } = {}) {
  if (!candidate || !candidate.name) throw new Error('invalid_candidate');
  const extracted = extractionResult?.ok ? extractionResult.extracted : null;
  const editionId = toSafeId('edition', candidate.externalId);
  const eventId = toSafeId('event', candidate.externalId);
  const timestamp = now.toISOString();

  const rewardHighlights = (extracted?.reward_highlights || []).map(item => item.value);
  const rewardAmount = Number.isFinite(Number(candidate.reward_amount)) ? Number(candidate.reward_amount) : null;
  const participantCount = Number.isFinite(Number(candidate.participant_count)) ? Number(candidate.participant_count) : null;

  return {
    id:editionId,
    eventId,
    name:String(candidate.name).slice(0, 200),
    editionName:String(candidate.seriesName ? `${candidate.seriesName}｜${candidate.name}` : candidate.name).slice(0, 200),
    aliases:[],
    organizer:extracted?.organizer ? String(extracted.organizer.value).slice(0, 200) : '',
    eventLevel:'其他/未明确',
    objectiveTags:(candidate.tags || []).filter(tag => typeof tag === 'string').slice(0, 10),
    professions:[], // 见文件头第三条：映射是判断，不猜
    participants:'',
    eligibility:'',
    formatAndRules:'',
    teamSize:'',
    participationFormat:'暂未明确',
    teamSizeCategory:'暂未明确',
    registrationMethod:'',
    registrationOrganization:extracted?.registration_organization?.value || '暂未明确',
    registrationUrl:String(candidate.detailUrl || ''),
    fees:'',
    feeType:'暂未公布',
    lastVerifiedAt:timestamp,

    // 抓来的一律是草稿，发布闸必然拦住
    dataStatus:'draft',
    systemValidation:'not_run',
    manualReview:'pending',
    qualityIssues:buildReviewNotes(candidate, extracted),

    schedule:{
      id:`schedule-${editionId}`,
      edition_id:editionId,
      track_id:null,
      registration_start:candidate.registration_start || null,
      registration_end:candidate.registration_end || null,
      competition_start:candidate.competition_start || null,
      competition_end:candidate.competition_end || null,
      pending_announcement:!candidate.registration_end,
      status_override:null,
      status_override_reason:null,
      time_note:'',
      change_status:'normal',
    },
    track:{ id:`track-${editionId}`, edition_id:editionId, name:'', scope_note:'' },
    recommendation:{
      id:`recommendation-${editionId}`,
      edition_id:editionId,
      recommendation:'信息不足',
      suitable_for:'', reasons:[], evidence_refs:[], limitations:[], preparation:'',
      confidence:'低', missing_information:extracted?.missing || [],
      system_validation:'not_run', manual_review:'pending',
    },
    sources:[{
      id:`source-${editionId}-detail`,
      edition_id:editionId,
      url:String(candidate.detailUrl || ''),
      source_type:'organizer_website',
      // 抓来的来源尚未核验，不能自称官方 —— 发布闸要求有效官方来源，
      // 这里如实标记，等人工确认后再改。
      is_official:false,
      published_at:null,
      last_verified_at:timestamp,
      validity_status:'unchecked',
    }],

    rewardAmount,
    rewardTier:deriveRewardTier(rewardAmount),
    rewardHighlights,
    rewards:firstQuote(extracted?.reward_highlights, '现金奖金') || candidate.rewards || '',
    participantCount,
    participantUnit:participantCount === null ? '暂未公布' : (candidate.participant_unit || '队'),
    scaleTier:deriveScaleTier(participantCount),
    participantScale:candidate.participant_scale || '',
    region:'',
    lifecycle:'暂未明确',
    // 认可度等级是判断，抽取只给建议。normalizeRecognition 会丢掉没有出处的条目。
    recognition:normalizeRecognition((extracted?.recognition_hints || []).map(hint => ({
      path:hint.path, level:hint.level, evidence:hint.quote, scope:hint.scope || [],
    }))),
  };
}

module.exports = { buildReviewNotes, candidateToRecord, toSafeId };
