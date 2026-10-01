const cloud = require('wx-server-sdk');
const { assertPublicRecordCapacity, currentRegistrationStatus, filterPublicRecords, isMissingCollection, MAX_PUBLIC_RECORDS, normalizePublicRecordId } = require('./publicQuery');

cloud.init({ env:cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
// 已归档的赛事也要能被查到——学生端靠"距离报名时间"筛选把它们翻出来看
// 下一届预计什么时候开始（见 publicQuery.js 的 registrationWithin）。
const gate = { data_status:_.in(['published', 'archived']), system_validation:'passed', manual_review:'passed' };
const PUBLIC_DATA_STATUSES = new Set(['published', 'archived']);

// 公开数据在实例里缓存一会儿（2026-10-01）：原先每次请求都把全部公开比赛从数据库读一遍再排序，
// 实测上海每次 0.4～0.9 秒。数据本来就是服务器每 5 分钟同步一次，缓存 60 秒对用户没有影响。
// 只在设了 PUBLIC_CACHE_SECONDS 的环境开（上海部署时设 60）；美国服务器上是兜底读取，不缓存，保证刚发布的马上能读到。
const CACHE_MS = Math.max(0, Number(process.env.PUBLIC_CACHE_SECONDS) || 0) * 1000;
let cached = { at:0, records:null };

async function loadPublishedRecordsCached({ refresh = false } = {}) {
  if (CACHE_MS && !refresh && cached.records && Date.now() - cached.at < CACHE_MS) return cached.records;
  const records = await loadPublishedRecords();
  if (CACHE_MS) { cached = { at:Date.now(), records }; listMemo.clear(); }
  return records;
}

// 同一个查询的排序结果也缓存（和上面的数据缓存同进同出）：实测数据缓存命中后，列表仍要约 0.3 秒，
// 时间花在 137 条记录的排序打分上（128MB 的实例分到的 CPU 很少）；首页默认查询人人相同，缓存后几乎不用再算。
const listMemo = new Map();
const LIST_MEMO_MAX = 200;
function filterCached(records, query) {
  if (!CACHE_MS) return filterPublicRecords(records, query);
  const key = JSON.stringify(query);
  if (listMemo.has(key)) return listMemo.get(key);
  const data = filterPublicRecords(records, query);
  if (listMemo.size >= LIST_MEMO_MAX) listMemo.delete(listMemo.keys().next().value);
  listMemo.set(key, data);
  return data;
}

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

// 经腾讯云 HTTP 访问服务（/public-data）进来的调用：event.body 是 JSON 字符串。
// 这条路只给服务器“保持运行”用（每 5 分钟同步完公开数据后调一次），别的动作一律拒绝——
// 小程序读数据走 wx.cloud.callFunction，不经过 HTTP。
// 为什么不用云开发自己的定时触发器：2026-09-15 查明它在这个环境不执行（见 sendReminders 的提交记录）。
function httpParams(event) {
  if (!event || typeof event.body !== 'string') return null;
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try { return JSON.parse(raw || '{}') || {}; } catch { return {}; }
}

// 记下最近一次“保持运行”的调用（谁触发的、什么时候），用来确认保持运行真的在跑
async function recordWarm(via) {
  if (process.env.COUNT_LOADS !== '1') return;
  try { await db.collection('admin_state').doc('public_data_warm').set({ data:{ at:new Date().toISOString(), via } }); } catch (_ignored) { /* 探针失败不影响 */ }
}

const isPublic = item => Boolean(item) && PUBLIC_DATA_STATUSES.has(item.data_status) && item.system_validation === 'passed' && item.manual_review === 'passed';

exports.main = async rawEvent => {
  const fromHttp = httpParams(rawEvent);
  if (fromHttp && fromHttp.action !== 'warm') return { ok:false, message:'forbidden' };
  const event = fromHttp || rawEvent;
  try {
    // 保持运行：服务器每 5 分钟经 HTTP 调一次（也保留云开发定时触发器，万一平台恢复了也能用），
    // 顺便刷新缓存，让实例不休眠、用户请求不用等冷启动。这类调用不算用户访问，不计数。
    if (event?.Type === 'Timer' || event?.action === 'warm') {
      const records = await loadPublishedRecordsCached({ refresh:true });
      await recordWarm(event?.Type === 'Timer' ? 'timer' : fromHttp ? 'http' : 'direct');
      return { ok:true, warmed:records.length };
    }
    if (event?.action === 'list') {
      // 访问计数和读数据同时进行，不再读完才开始写计数
      const [records] = await Promise.all([loadPublishedRecordsCached(), countLoad('list')]);
      return { ok:true, data:filterCached(records, event.query || {}) };
    }
    if (event?.action === 'get') {
      const id = normalizePublicRecordId(event.id);
      // 先在缓存里找；找不到（比如刚同步过来的）再查数据库
      const hit = CACHE_MS ? (await loadPublishedRecordsCached()).find(record => record.id === id || record._id === id) : null;
      const item = hit || (await db.collection('event_edition_public_cache').doc(id).get()).data;
      if (!isPublic(item)) throw new Error('public_record_not_found');
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
