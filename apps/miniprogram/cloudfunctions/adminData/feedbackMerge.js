function mergeFeedbackRecords(storedFeedbacks, submittedFeedbacks, maxRecords) {
  const feedbackById = new Map();
  for (const item of storedFeedbacks) {
    if (item && item.id) feedbackById.set(item.id, item);
  }
  // The feedback collection is canonical for user submissions. It must win over
  // the admin-state snapshot so AI or review updates are visible after reload.
  for (const item of submittedFeedbacks) {
    if (item && item.id) feedbackById.set(item.id, item);
  }
  return [...feedbackById.values()]
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, maxRecords);
}

function canonicalFeedbackDocumentId(item) {
  if (!item || typeof item.id !== 'string' || !item.id) throw new Error('invalid_feedback_id');
  if (item.cloudDocumentId && item.cloudDocumentId !== item.id) throw new Error('feedback_document_id_mismatch');
  return item.id;
}

module.exports = { canonicalFeedbackDocumentId, mergeFeedbackRecords };
