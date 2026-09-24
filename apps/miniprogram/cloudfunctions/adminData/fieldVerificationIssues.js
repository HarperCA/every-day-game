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

module.exports = { LEGACY_ISSUE, evidenceUnavailable, usableDate, classifyFieldVerificationIssues, replaceFieldVerificationIssues };
