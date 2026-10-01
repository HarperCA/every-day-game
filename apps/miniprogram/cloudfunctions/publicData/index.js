const cloud = require('wx-server-sdk');
const { assertPublicRecordCapacity, currentRegistrationStatus, filterPublicRecords, isMissingCollection, MAX_PUBLIC_RECORDS, normalizePublicRecordId } = require('./publicQuery');

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

// 每天记一个“成功加载次数”，后台“访问异常”页据此算加载成功率（2026-10-01 起）。
// 只在腾讯云开发上海环境记（部署时设了 COUNT_LOADS=1）；美国服务器跑的是同一份代码，不记。
// 计数失败不能影响正常返回。
async function countLoad(action) {
  if (process.env.COUNT_LOADS !== '1') return;
  const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); // 北京时间的日期
  const stats = db.collection('client_stats');
  try {
    const updated = await stats.doc(date).update({ data:{ [action]:_.inc(1) } });
    if (updated?.stats?.updated) return;
    await stats.doc(date).set({ data:{ date, list:0, get:0, [action]:1 } });
  } catch (error) {
    if (!isMissingCollection(error)) return;
    try {
      await db.createCollection('client_stats');
      await stats.doc(date).set({ data:{ date, list:0, get:0, [action]:1 } });
    } catch (_ignored) { /* 下一次再建 */ }
  }
}

exports.main = async event => {
  try {
    if (event?.action === 'list') {
      const data = filterPublicRecords(await loadPublishedRecords(), event.query || {});
      await countLoad('list');
      return { ok:true, data };
    }
    if (event?.action === 'get') {
      const id = normalizePublicRecordId(event.id);
      const result = await db.collection('event_edition_public_cache').doc(id).get();
      const item = result.data;
      if (!item || !PUBLIC_DATA_STATUSES.has(item.data_status) || item.system_validation !== 'passed' || item.manual_review !== 'passed') throw new Error('public_record_not_found');
      await countLoad('get');
      return { ok:true, data:{ ...item, registration_status:currentRegistrationStatus(item) } };
    }
    throw new Error('unsupported_action');
  } catch (error) {
    // 只有 get 才谈得上「这一条找不到」；list 找不到集合已经在上面归零了。
    const missing = error?.errCode === -1 || isMissingCollection(error) || /not found/i.test(error?.message || '');
    return { ok:false, message:missing ? 'public_record_not_found' : error instanceof Error ? error.message : 'public_data_failed' };
  }
};
