const cloud = require('wx-server-sdk');
const { assertPublicRecordCapacity, currentRegistrationStatus, filterPublicRecords, isMissingCollection, MAX_PUBLIC_RECORDS, normalizePublicRecordId } = require('./publicQuery');
const { sanitizeBatch, createRateLimiter } = require('./webEvents');

const trackLimiter = createRateLimiter();

cloud.init({ env:cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
// 已归档的赛事也要能被查到——学生端靠"距离报名时间"筛选把它们翻出来看
// 下一届预计什么时候开始（见 publicQuery.js 的 registrationWithin）。
const gate = { data_status:_.in(['published', 'archived']), system_validation:'passed', manual_review:'passed' };
const PUBLIC_DATA_STATUSES = new Set(['published', 'archived']);

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
      if (!item || !PUBLIC_DATA_STATUSES.has(item.data_status) || item.system_validation !== 'passed' || item.manual_review !== 'passed') throw new Error('public_record_not_found');
      return { ok:true, data:{ ...item, registration_status:currentRegistrationStatus(item) } };
    }
    // 网页测试版的匿名使用统计（见 webEvents.js）。超限或格式不对时静默丢弃，不影响页面。
    if (event?.action === 'track') {
      const { visitor, items } = sanitizeBatch(event);
      if (!items.length || !trackLimiter.allow(visitor, items.length)) return { ok:true, data:{ saved:0 } };
      for (const item of items) await db.collection('web_events').add({ data:item });
      return { ok:true, data:{ saved:items.length } };
    }
    throw new Error('unsupported_action');
  } catch (error) {
    // 只有 get 才谈得上「这一条找不到」；list 找不到集合已经在上面归零了。
    const missing = error?.errCode === -1 || isMissingCollection(error) || /not found/i.test(error?.message || '');
    return { ok:false, message:missing ? 'public_record_not_found' : error instanceof Error ? error.message : 'public_data_failed' };
  }
};
