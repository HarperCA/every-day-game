const FEEDBACK_CATEGORIES = new Set(['time', 'registration_link', 'eligibility', 'rules', 'other']);

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`invalid_${field}`);
  return value.trim();
}

function validateFeedbackInput(event) {
  const editionId = requiredText(event.editionId, 'edition_id');
  if (editionId.length > 200) throw new Error('invalid_edition_id');
  const competitionName = requiredText(event.competitionName, 'competition_name');
  if (competitionName.length > 200) throw new Error('invalid_competition_name');
  const category = requiredText(event.category, 'category');
  if (!FEEDBACK_CATEGORIES.has(category)) throw new Error('invalid_category');
  const content = requiredText(event.content, 'content');
  if (content.length < 5 || content.length > 2000) throw new Error('invalid_content_length');
  const evidenceUrl = String(event.evidenceUrl || '').trim();
  if (evidenceUrl && (!/^https?:\/\//i.test(evidenceUrl) || evidenceUrl.length > 2048)) throw new Error('invalid_evidence_url');
  return { editionId, competitionName, category, content, evidenceUrl };
}

module.exports = { validateFeedbackInput };
