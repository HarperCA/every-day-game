// 审核结果回传（美国服务器这一端，2026-11-02）：美国后台审核纠错、处理意见反馈、审核校赛管理员和校赛（2026-11-08）后，调这里把结果写回北京的正本（用户在小程序里看得到）。
// 北京交回改好的那一行，这里顺手写进美国的用户副本（同步代码才能写副本），不用等下一轮用户数据同步——
// 否则副本里还是旧的修改时间，再处理一次会被北京当成冲突。格式见 北京端.mjs；签名和公开比赛同步共用。
// 后台服务（美国/后台/服务.mjs）把它包好放进环境，后台的 数据库.mjs 只管调，不碰网络和秘钥。
//
//   回传({ 地址, 秘钥, 种类, 编号, 改动, 读到的更新时间, 副本库, fetch, now }) → 改好的那一行；北京不收时抛出北京给的原因
//     要 SYNC_REVIEW_ENDPOINT（北京的 https://…/sync/review）、SYNC_SECRET（或 SYNC_SECRET_FILE）
import { 用户副本 } from '../../美国/db/index.mjs';
import { 时间头, 签名, 签名头 } from '../公开比赛同步/格式.mjs';

const 表 = { 纠错: 'feedback', 意见反馈: 'general_feedback', 校赛管理员: 'school_admin', 校赛: 'school_contest' };

export async function 回传({ 地址, 秘钥, 种类, 编号, 改动, 读到的更新时间, 副本库, fetch = globalThis.fetch, now = new Date() }) {
  if (!地址 || !秘钥) throw new Error('没配北京的回传地址或同步秘钥（SYNC_REVIEW_ENDPOINT、SYNC_SECRET），处理结果写不回北京');
  const 正文 = JSON.stringify({ 种类, 编号, 改动, 读到的更新时间 });
  const 时间 = now.getTime();
  const 回应 = await fetch(地址, {
    method: 'POST', body: 正文,
    headers: { 'Content-Type': 'application/json', [时间头]: String(时间), [签名头]: 签名(秘钥, 时间, 正文) },
    signal: AbortSignal.timeout(20_000),
  });
  const 回 = await 回应.json().catch(() => null);
  if (!回应.ok || !回?.ok) throw new Error(回?.message || `北京没收下（HTTP ${回应.status}）`);
  if (副本库 && 表[种类]) 用户副本.写(副本库, [{ 表: 表[种类], 编号: String(回.行.id), data: 回.行 }], { now });
  return 回.行;
}
