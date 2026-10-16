// 公开赛事数据同步（2026-10-01 起）：自有服务器在美国，国内手机跨境访问又慢又时常连不上
// （测试用户遇到 request:fail -118 ERR_CONNECTION_TIMED_OUT）。所以服务器把公开缓存
// event_edition_public_cache 推一份到这个上海环境的云数据库，小程序浏览赛事改读这里的 publicData，
// 走微信内网；美国服务器那份仍保留，上海失败时小程序退回去读。
//
// 只接受带密钥（环境变量 SYNC_SECRET）的调用，由服务器上的 sync-public-cache.mjs 经 HTTP 访问服务调用：
//   upsert：写入或覆盖若干条（每条带 id）
//   prune ：只保留给定 id，其余删掉（服务器那边下架、删除的赛事）
//   status：返回现有条数
const crypto = require('node:crypto');
const cloud = require('wx-server-sdk');
const { aggregatePreferences } = require('./preferenceValidation');
const { pullIssuePage } = require('./logPagination');

cloud.init({ env:cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COLLECTION = 'event_edition_public_cache';
const MAX_UPSERT = 100;

function secretMatches(given) {
  const expected = process.env.SYNC_SECRET || '';
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(expected);
  return expected.length >= 32 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 既能被 HTTP 访问服务调用（event.body 是 JSON 字符串），也能被直接调用（event 就是参数）
function readParams(event) {
  if (event && typeof event.body === 'string') {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return event || {};
}

const missingCollection = error => /-502005|collection not exists|DATABASE_COLLECTION_NOT_EXIST/i.test(String(error?.errCode || '') + String(error?.message || error));

// 这个环境以前没存过公开数据，第一次写入时集合还不存在：建好再写
async function setDoc(id, data) {
  try {
    await db.collection(COLLECTION).doc(id).set({ data });
  } catch (error) {
    if (!missingCollection(error)) throw error;
    await db.createCollection(COLLECTION).catch(createError => { if (!/exist/i.test(String(createError?.message || createError))) throw createError; });
    await db.collection(COLLECTION).doc(id).set({ data });
  }
}

const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(id);

async function allIds() {
  const ids = [];
  for (let skip = 0; ; skip += 1000) {
    const page = await db.collection(COLLECTION).field({ _id:true }).skip(skip).limit(1000).get().catch(error => {
      if (missingCollection(error)) return { data:[] };
      throw error;
    });
    ids.push(...(page.data || []).map(item => item._id));
    if ((page.data || []).length < 1000) return ids;
  }
}

exports.main = async event => {
  const params = readParams(event);
  if (!secretMatches(params.secret)) return { ok:false, status:'forbidden' };
  try {
    if (params.action === 'upsert') {
      if (!Array.isArray(params.records) || params.records.length > MAX_UPSERT || params.records.some(record => !record || !validId(record.id))) return { ok:false, status:'invalid_records' };
      const records = params.records;
      let saved = 0;
      for (const record of records) {
        if (!record || !validId(record.id)) continue;
        const { _id, ...data } = record;
        await setDoc(record.id, data);
        saved += 1;
      }
      return { ok:true, status:'ok', saved };
    }
    if (params.action === 'prune') {
      if (!Array.isArray(params.keepIds)) return { ok:false, status:'keep_ids_required' };
      const keep = new Set(params.keepIds.filter(validId));
      // 防误删：服务器那边一条都给不出来时不动（多半是读库出错，而不是真的全部下架）
      if (!keep.size) return { ok:false, status:'refuse_empty_keep' };
      let removed = 0;
      for (const id of await allIds()) {
        if (keep.has(id)) continue;
        await db.collection(COLLECTION).doc(id).remove();
        removed += 1;
      }
      return { ok:true, status:'ok', removed };
    }
    if (params.action === 'status') return { ok:true, status:'ok', count:(await allIds()).length };
    // 访问异常（clientLog 云函数收的）和每日成功加载次数（publicData 记的），给美国服务器拉回去在后台显示
    if (params.action === 'pullClientLogs') {
      const _ = db.command;
      const page = await pullIssuePage(db, params, missingCollection);
      const fromDate = String(params.statsFrom || '1970-01-01');
      const stats = await db.collection('client_stats').where({ date:_.gte(fromDate) }).limit(100).get()
        .then(r => r.data || []).catch(error => {
          if (missingCollection(error)) return [];
          throw error;
        });
      return { ok:true, status:'ok', ...page, stats };
    }
    // 偏好问卷统计（userData 存的 user_preference）：只回计数，不带账号信息，给美国服务器后台“问卷统计”页显示
    if (params.action === 'pullPreferenceStats') {
      const rows = [];
      for (let skip = 0; skip < 50000; skip += 1000) {
        const page = await db.collection('user_preference').field({ profession:true, categories:true, province:true, survey_status:true })
          .skip(skip).limit(1000).get().catch(error => { if (missingCollection(error)) return { data:[] }; throw error; });
        rows.push(...(page.data || []));
        if ((page.data || []).length < 1000) break;
      }
      return { ok:true, status:'ok', stats:{ ...aggregatePreferences(rows), generatedAt:new Date().toISOString() } };
    }
    return { ok:false, status:'unsupported_action' };
  } catch (error) {
    return { ok:false, status:'error', error:String(error?.message || error).slice(0, 300) };
  }
};
