// 一次性迁移用的云函数（2026-10-01）：把美国服务器上的账号、收藏、提醒原样（保留原编号）写进腾讯云开发上海环境。
// 迁移完成后删掉这个函数。
//
// 只接受从腾讯云命令行直接调用：小程序里调用的请求一定带着用户的 OPENID，带了就拒绝；也不开 HTTP 访问。
// 只能写这三个集合，按原编号覆盖写（同一条重复导入结果一样）。
const cloud = require('wx-server-sdk');

cloud.init({ env:cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const ALLOWED = new Set(['user_account', 'favorite', 'reminder']);
const MAX_DOCS = 200;

const missingCollection = error => /-502005|collection not exists|DATABASE_COLLECTION_NOT_EXIST/i.test(String(error?.errCode || '') + String(error?.message || error));

async function setDoc(collection, id, data) {
  try {
    await db.collection(collection).doc(id).set({ data });
  } catch (error) {
    if (!missingCollection(error)) throw error;
    await db.createCollection(collection).catch(createError => { if (!/exist/i.test(String(createError?.message || createError))) throw createError; });
    await db.collection(collection).doc(id).set({ data });
  }
}

exports.main = async event => {
  if (cloud.getWXContext().OPENID) return { ok:false, message:'forbidden' };
  const { action, collection, docs } = event || {};
  if (!ALLOWED.has(collection)) return { ok:false, message:'invalid_collection' };
  if (action === 'count') {
    try { return { ok:true, total:(await db.collection(collection).count()).total }; }
    catch (error) { if (missingCollection(error)) return { ok:true, total:0 }; throw error; }
  }
  // 迁移前核对：看上海这边已有哪些（9 月迁去美国之前留下的旧数据）
  if (action === 'list') {
    try { return { ok:true, docs:(await db.collection(collection).limit(100).get()).data }; }
    catch (error) { if (missingCollection(error)) return { ok:true, docs:[] }; throw error; }
  }
  if (action === 'remove') {
    if (!Array.isArray(event.ids) || event.ids.length > MAX_DOCS) return { ok:false, message:'invalid_ids' };
    let removed = 0;
    for (const id of event.ids) { await db.collection(collection).doc(String(id)).remove(); removed += 1; }
    return { ok:true, removed };
  }
  if (action === 'upsert') {
    if (!Array.isArray(docs) || docs.length > MAX_DOCS) return { ok:false, message:'invalid_docs' };
    let written = 0;
    for (const doc of docs) {
      const { _id, ...data } = doc || {};
      if (typeof _id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(_id)) return { ok:false, message:`invalid_id:${String(_id).slice(0, 40)}`, written };
      await setDoc(collection, _id, data);
      written += 1;
    }
    return { ok:true, written };
  }
  return { ok:false, message:'unsupported_action' };
};
