// 将周检的不同失败原因拆开；来源没读到不能解释成字段已被证实错误。
const LEGACY_ISSUE = 'Kimi周检发现问题但给不出可用的修正值，需人工核对';
const PREFIX = '周检：';

function evidenceUnavailable(verification = {}) {
  const evidence = verification.evidence_status;
  return Array.isArray(evidence)
    && !evidence.some(item => item.status === 'reachable' && Number(item.chars) > 0);
}

function usableDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function classifyFieldVerificationIssues(record, verification = {}) {
  if (evidenceUnavailable(verification)) return [`${PREFIX}来源正文未能读取，无法核验名称、时间和链接；需重试或补充官方来源`];
  const issues = [];
  if (verification.name_correct === false && !String(verification.name_correction || '').trim()) {
    issues.push(`${PREFIX}赛事名称未获来源确认，且没有可核验的修正名称`);
  }
  for (const [key, label] of [['registration_start', '报名开始时间'], ['registration_end', '报名截止时间']]) {
    const status = verification[`${key}_status`];
    if (status === 'not_specified' && record.schedule?.[key]) {
      issues.push(`${PREFIX}${label}在库中有精确日期，但本次读取的来源未给出精确日期；需核对原始依据`);
    } else if (status === 'incorrect' && !usableDate(verification[`${key}_correction`])) {
      issues.push(`${PREFIX}${label}与来源冲突，但未取得可用的 YYYY-MM-DD 修正日期`);
    } else if (!status && verification[`${key}_correct`] === false && record.schedule?.[key]) {
      issues.push(`${PREFIX}${label}在库中有精确日期，但旧版核验未确认；需重新核对原始依据`);
    }
  }
  if (verification.registration_url_correct === false && !/^https?:\/\//i.test(String(verification.registration_url_correction || ''))) {
    issues.push(`${PREFIX}报名或详情链接未获来源确认，且没有可用的修正网址`);
  }
  return issues;
}

function replaceFieldVerificationIssues(existing, issues) {
  return [...(Array.isArray(existing) ? existing : []).filter(item =>
    !String(item).includes(LEGACY_ISSUE) && !String(item).startsWith(PREFIX)), ...issues];
}

// 已发布记录的周检：AI 只提意见，不改线上字段（2026-09-29 起）。
// 原先的做法是给出修正值就直接改，结果来源是学校转发通知时，把“校内报名截止”当成赛事截止日改了上去，
// 随后被判过期归档（一轮误归档 8 条）。现在修正值只写进问题列表、打“需人工核对”，由人决定。
// 取证失败、读不到原有日期等情况的处理不变（classifyFieldVerificationIssues）。
function applyPublishedFieldCorrections(record, verification, now) {
  const timestamp = now.toISOString();
  const suggestions = [];
  if (!evidenceUnavailable(verification)) {
    if (!verification.name_correct && verification.name_correction) {
      suggestions.push(`周检：名称与来源不符，来源写作「${String(verification.name_correction).slice(0, 200)}」（未自动修改）`);
    }
    for (const [key, label] of [['registration_start', '报名开始时间'], ['registration_end', '报名截止时间']]) {
      const correction = verification[`${key}_correction`];
      if (verification[`${key}_status`] === 'incorrect' && usableDate(correction)) {
        suggestions.push(`周检：${label}与来源不符，来源为 ${String(correction).slice(0, 10)}（未自动修改；请确认来源是赛事官方通知而非校内通知）`);
      }
    }
    if (!verification.registration_url_correct && /^https?:\/\//i.test(verification.registration_url_correction || '')) {
      suggestions.push(`周检：报名链接与来源不符，来源为 ${verification.registration_url_correction}（未自动修改）`);
    }
  }
  const issues = [...suggestions, ...classifyFieldVerificationIssues(record, verification)];
  const qualityIssues = replaceFieldVerificationIssues(record.qualityIssues, issues);
  // AI 身份审核打的“需人工核对”标记（quarantine.js）不能被周检通过清掉。
  const identityFlagged = qualityIssues.some(item => String(item).startsWith('AI身份审核：'));
  return {
    ...record,
    fieldVerification:verification,
    needsManualReview:issues.length > 0 || identityFlagged,
    qualityIssues,
    lastVerifiedAt:issues.length ? record.lastVerifiedAt : timestamp,
    updatedAt:timestamp,
    updatedBy:'kimi-weekly-field-verification',
  };
}

module.exports = { LEGACY_ISSUE, evidenceUnavailable, usableDate, classifyFieldVerificationIssues, replaceFieldVerificationIssues, applyPublishedFieldCorrections };
