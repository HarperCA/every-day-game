// 读公开比赛：条件与 publicData/index.js 的 loadPublishedRecords 一致（已发布或已归档，且系统验证、人工审核都通过）
const { assertPublicRecordCapacity, isMissingCollection, MAX_PUBLIC_RECORDS } = require('./publicQuery');

async function loadPublicRecords(db) {
  const _ = db.command;
  const gate = { data_status:_.in(['published', 'archived']), system_validation:'passed', manual_review:'passed' };
  try {
    const result = await db.collection('event_edition_public_cache').where(gate).limit(MAX_PUBLIC_RECORDS + 1).get();
    return assertPublicRecordCapacity(result.data || []);
  } catch (error) {
    if (isMissingCollection(error)) return [];
    throw error;
  }
}

module.exports = { loadPublicRecords };
