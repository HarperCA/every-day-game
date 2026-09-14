const cloud = require('wx-server-sdk');
const { assertPublicRecordCapacity, currentRegistrationStatus, filterPublicRecords, MAX_PUBLIC_RECORDS, normalizePublicRecordId } = require('./publicQuery');

cloud.init({ env:cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const gate = { data_status:'published', system_validation:'passed', manual_review:'passed' };

async function loadPublishedRecords() {
  const result = await db.collection('event_edition_public_cache').where(gate).limit(MAX_PUBLIC_RECORDS + 1).get();
  return assertPublicRecordCapacity(result.data || []);
}

exports.main = async event => {
  try {
    if (event?.action === 'list') return { ok:true, data:filterPublicRecords(await loadPublishedRecords(), event.query || {}) };
    if (event?.action === 'get') {
      const id = normalizePublicRecordId(event.id);
      const result = await db.collection('event_edition_public_cache').doc(id).get();
      const item = result.data;
      if (!item || item.data_status !== 'published' || item.system_validation !== 'passed' || item.manual_review !== 'passed') throw new Error('public_record_not_found');
      return { ok:true, data:{ ...item, registration_status:currentRegistrationStatus(item) } };
    }
    throw new Error('unsupported_action');
  } catch (error) {
    const missing = error?.errCode === -1 || /not exist|not found/i.test(error?.message || '');
    return { ok:false, message:missing ? 'public_record_not_found' : error instanceof Error ? error.message : 'public_data_failed' };
  }
};
