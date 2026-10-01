// 小程序访问异常上报（2026-10-01 起，见小程序 services/clientLog.ts）。
// 部署在腾讯云开发上海环境，小程序经 wx.cloud 调用（走微信内网，美国服务器连不上时也能报上来）。
// 只收白名单里的字段、逐个截断；不记 IP、微信身份。美国服务器经 publicSync 的 pullClientLogs 拉走。
const cloud = require('wx-server-sdk');
const { sanitizeEvents } = require('./sanitize');

cloud.init({ env:cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COLLECTION = 'client_issues';

const missingCollection = error => /-502005|collection not exists|DATABASE_COLLECTION_NOT_EXIST/i.test(String(error?.errCode || '') + String(error?.message || error));

async function addIssue(data) {
  try {
    await db.collection(COLLECTION).add({ data });
  } catch (error) {
    if (!missingCollection(error)) throw error;
    await db.createCollection(COLLECTION).catch(createError => { if (!/exist/i.test(String(createError?.message || createError))) throw createError; });
    await db.collection(COLLECTION).add({ data });
  }
}

exports.main = async event => {
  try {
    const receivedAt = new Date().toISOString();
    const events = sanitizeEvents(event?.events, receivedAt);
    for (const item of events) await addIssue(item);
    return { ok:true, saved:events.length };
  } catch (error) {
    return { ok:false, message:String(error?.message || error).slice(0, 200) };
  }
};
