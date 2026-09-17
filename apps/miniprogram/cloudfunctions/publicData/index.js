const cloud = require('wx-server-sdk');
const { assertPublicRecordCapacity, currentRegistrationStatus, filterPublicRecords, isMissingCollection, MAX_PUBLIC_RECORDS, normalizePublicRecordId } = require('./publicQuery');

cloud.init({ env:cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const gate = { data_status:'published', system_validation:'passed', manual_review:'passed' };

async function loadPublishedRecords() {
  try {
    const result = await db.collection('event_edition_public_cache').where(gate).limit(MAX_PUBLIC_RECORDS + 1).get();
    return assertPublicRecordCapacity(result.data || []);
  } catch (error) {
    // 集合尚未建立 ≡ 一条都还没发布。列表返回空，由客户端决定怎么呈现；
    // 其余数据库错误照旧往上抛，不能被当成「没有数据」吞掉。
    if (isMissingCollection(error)) return [];
    throw error;
  }
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
    // 只有 get 才谈得上「这一条找不到」；list 找不到集合已经在上面归零了。
    const missing = error?.errCode === -1 || isMissingCollection(error) || /not found/i.test(error?.message || '');
    return { ok:false, message:missing ? 'public_record_not_found' : error instanceof Error ? error.message : 'public_data_failed' };
  }
};
