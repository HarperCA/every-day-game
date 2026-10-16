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
async function submit(db, userId, input) {
  const normalized = validateSubmission(input);
  const now = new Date().toISOString();
  const record = { id:`general-feedback-${crypto.randomBytes(12).toString('hex')}`, user_id:userId,
    type:normalized.type, content:normalized.content, contact:normalized.contact, app_version:normalized.appVersion,
    status:'pending', public_reply:'', internal_note:'', created_at:now, updated_at:now, resolved_at:null, data_version:1 };
  await db.collection('general_feedback').doc(record.id).set({ data:record });
  return { feedback:toClient(record) };
}
async function list(db, input, userId) {
  const page = Math.max(1, Math.min(10000, Math.floor(Number(input.page) || 1)));
  const pageSize = Math.max(1, Math.min(50, Math.floor(Number(input.pageSize) || 20)));
  const filter = userId ? { user_id:userId } : {};
  if (!userId && input.status) {
    if (!STATUSES.includes(input.status)) throw new Error('invalid_feedback_status');
    filter.status = input.status;
  }
  if (!userId && input.type) {
    if (!TYPES.includes(input.type)) throw new Error('invalid_feedback_type');
    filter.type = input.type;
  }
  const collection = db.collection('general_feedback').where(filter);
  let rows, count;
  try {
    [rows, count] = await Promise.all([collection.orderBy('created_at', 'desc').skip((page - 1) * pageSize).limit(pageSize).get(), collection.count()]);
  } catch (error) {
    if (/-502005|collection.*(not exist|not found)|DATABASE_COLLECTION_NOT_EXIST/i.test(String(error.errCode || '') + String(error.message || ''))) return { items:[], total:0, hasMore:false };
    throw error;
  }
  return { items:(rows.data || []).map(item => userId ? toClient(item) : { ...toClient(item), userId:item.user_id, internalNote:item.internal_note || '', appVersion:item.app_version || '' }),
    total:count.total, hasMore:page * pageSize < count.total };
}
async function update(db, input) {
  const normalized = validateUpdate(input);
  return db.runTransaction(async transaction => {
    const ref = transaction.collection('general_feedback').doc(normalized.id);
    const result = await ref.get();
    if (!result.data || result.data.id !== normalized.id) throw new Error('feedback_not_found');
    if (result.data.updated_at !== normalized.expectedUpdatedAt) throw new Error('feedback_conflict');
    // The optimistic lock must change even when two saves happen in one millisecond.
    const previousAt = Date.parse(result.data.updated_at);
    const now = new Date(Math.max(Date.now(), Number.isFinite(previousAt) ? previousAt + 1 : 0)).toISOString();
    const change = { status:normalized.status, public_reply:normalized.publicReply, internal_note:normalized.internalNote,
      updated_at:now, resolved_at:normalized.status === 'resolved' ? (result.data.resolved_at || now) : null };
    await ref.update({ data:change });
    return { feedback:{ ...toClient({ ...result.data, ...change }), internalNote:change.internal_note } };
  });
}
module.exports = { validateSubmission, validateUpdate, toClient, submit, list, update };
