// 意见反馈的校验和交回格式：搬自上海 userData/generalFeedback.js（2026-11-02），原样；存取（submit、list、update 用的云开发集合）去掉了，北京由 index.mjs 调副数据库的 意见反馈.*。
const crypto = require('crypto');
const TYPES = ['bug', 'suggestion', 'data', 'other'];
const STATUSES = ['pending', 'processing', 'resolved'];
function text(value, field, max, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string') throw new Error(`invalid_${field}`);
  const result = value.trim();
  if ((required && !result) || result.length > max) throw new Error(`invalid_${field}`);
  return result;
}
function validateSubmission(input) {
  const type = input.type || 'other';
  if (!TYPES.includes(type)) throw new Error('invalid_feedback_type');
  return { type, content:text(input.content, 'content', 2000, true), contact:text(input.contact, 'contact', 200), appVersion:text(input.appVersion, 'app_version', 40) };
}
function toClient(item) {
  return { id:item.id, type:item.type, content:item.content, contact:item.contact || '', status:item.status,
    publicReply:item.public_reply || '', createdAt:item.created_at, updatedAt:item.updated_at, resolvedAt:item.resolved_at || null };
}
function validateUpdate(input) {
  const id = text(input.id, 'feedback_id', 200, true);
  if (!STATUSES.includes(input.status)) throw new Error('invalid_feedback_status');
  const publicReply = text(input.publicReply, 'public_reply', 2000);
  if (input.status === 'resolved' && !publicReply) throw new Error('resolved_feedback_requires_reply');
  return { id, status:input.status, publicReply, internalNote:text(input.internalNote, 'internal_note', 2000), expectedUpdatedAt:text(input.expectedUpdatedAt, 'expected_updated_at', 40, true) };
}
module.exports = { TYPES, STATUSES, validateSubmission, validateUpdate, toClient };
