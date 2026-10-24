// 公开赛事数据同步（2026-10-01 起）：自有服务器在美国，国内手机跨境访问又慢又时常连不上
// （测试用户遇到 request:fail -118 ERR_CONNECTION_TIMED_OUT）。所以服务器把公开缓存
// event_edition_public_cache 推一份到这个上海环境的云数据库，小程序浏览赛事改读这里的 publicData，
// 走微信内网；美国服务器那份仍保留，上海失败时小程序退回去读。
//
// 只接受带密钥（环境变量 SYNC_SECRET）的调用，由服务器上的 sync-public-cache.mjs 经 HTTP 访问服务调用：
//   upsert：写入或覆盖若干条（每条带 id）
//   prune ：只保留给定 id，其余删掉（服务器那边下架、删除的赛事）
//   status：返回现有条数
//   uploadPoster ：存一张海报到云存储 posters/ 目录，返回文件 ID 和 https 链接（2026-10-24）
//   deletePosters：删掉不再用的海报文件
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

// 海报（2026-10-24）：美国服务器同步时一张一请求推过来（HTTP 访问服务单次请求上限实测在 96～100 KB 之间，
// 海报压在 60 KB 以内，编码后约 80 KB）。文件名是图片内容的哈希，只收 640×360 的 JPG。
const POSTER_FILE = /^[0-9a-f]{64}\.jpg$/;
const POSTER_MAX_BYTES = 60 * 1024;

function jpegSize(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width:buffer.readUInt16BE(offset + 7), height:buffer.readUInt16BE(offset + 5) };
    offset += 2 + buffer.readUInt16BE(offset + 2);
  }
  return null;
}

async function uploadPoster(params) {
  if (!POSTER_FILE.test(String(params.file || ''))) return { ok:false, status:'invalid_poster_file' };
  const buffer = Buffer.from(String(params.data || ''), 'base64');
  const size = jpegSize(buffer);
  if (!size || size.width !== 640 || size.height !== 360 || buffer.length > POSTER_MAX_BYTES) return { ok:false, status:'invalid_poster_image' };
  // 文件名就是内容哈希：对不上说明传输出错，不存
  if (crypto.createHash('sha256').update(buffer).digest('hex') !== params.file.slice(0, 64)) return { ok:false, status:'poster_hash_mismatch' };
  const { fileID } = await cloud.uploadFile({ cloudPath:`posters/${params.file}`, fileContent:buffer });
  const { fileList } = await cloud.getTempFileURL({ fileList:[fileID] });
  const url = fileList?.[0]?.tempFileURL || '';
  if (!url) return { ok:false, status:'poster_url_missing' };
  return { ok:true, status:'ok', fileID, url };
}

async function deletePosters(params) {
  const fileIDs = Array.isArray(params.fileIDs) ? params.fileIDs.filter(id => typeof id === 'string' && /^cloud:\/\/[^/]+\/posters\/[0-9a-f]{64}\.jpg$/.test(id)) : [];
  if (!fileIDs.length) return { ok:true, status:'ok', removed:0 };
  const { fileList } = await cloud.deleteFile({ fileList:fileIDs.slice(0, 50) });
  return { ok:true, status:'ok', removed:(fileList || []).filter(item => item.status === 0).length };
}

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
    if (params.action === 'uploadPoster') return await uploadPoster(params);
    if (params.action === 'deletePosters') return await deletePosters(params);
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
