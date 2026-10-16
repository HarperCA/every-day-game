const cloud = require('wx-server-sdk');
const { requireActiveAccount } = require('./loginPolicy');
const { forwardIfConfigured } = require('./cloudBridge');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  let forwarded;
  try { forwarded = await forwardIfConfigured('login', {}, cloud.getWXContext()); }
  catch (error) { return { ok:false, message:error instanceof Error ? error.message : 'cloud_bridge_failed' }; }
  if (forwarded) return forwarded;
  const { OPENID, APPID, UNIONID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, message: '无法取得微信用户身份' };

  const collection = db.collection('user_account');
  const now = new Date().toISOString();
  let existing = await collection.where({ openid: OPENID }).limit(1).get();
  let isNewUser = false;
  let userId;

  if (existing.data.length) {
    userId = requireActiveAccount(existing.data[0])._id;
    await collection.doc(userId).update({ data: { appid: APPID || null, unionid: UNIONID || null, last_login_at: now, updated_at: now } });
  } else {
    isNewUser = true;
    try {
      const created = await collection.add({ data: { openid: OPENID, appid: APPID || null, unionid: UNIONID || null, status: 'active', created_at: now, updated_at: now, last_login_at: now } });
      userId = created._id;
    } catch (error) {
      // 唯一索引处理同一用户并发首次登录；冲突时重新读取已创建的账号。
      existing = await collection.where({ openid: OPENID }).limit(1).get();
      if (!existing.data.length) throw error;
      userId = requireActiveAccount(existing.data[0])._id;
      isNewUser = false;
    }
  }

  // openid 是用户自己的微信身份，返回给小程序：纠错反馈仍走美国服务器，那边要靠它认人（2026-10-01）
  return { ok: true, data: { userId, isNewUser, openid: OPENID } };
};
