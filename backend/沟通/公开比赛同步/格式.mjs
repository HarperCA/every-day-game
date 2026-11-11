// 公开比赛同步的格式和秘钥规则，美国端、北京端共用这一份（2026-11-02）。
//
// 一、公开字段白名单：照旧 adminData/publicCache.js 的 toPublicCache 公开的那些，字段名用美国比赛库的（北京的用户呈现模块、排序、详情都读这些名字，
//    要换成小程序的旧名字时在北京拼卡片、详情的地方换）。
//    不公开：状态理由、人工改过的字段、发现途径、AI 核对过程、旧记录原样保留的内容（legacy）、候选海报、谁建的谁改的。
//   整理比赛(比赛行)            → { id, version, name, level, data }
//   整理届次(届次行, 来源们)     → { id, competition_id, version, registration_start, registration_end, status, data }
//     推荐只留等级、理由（最多 3 条）、适合谁、局限、准备建议、把握；海报只带图片总库的文件名；
//     下一届预计只给已归档的：先用每日归档算出存的 next_edition_estimate（2026-11-03 起），没有再用旧记录带过来的 legacy.nextEditionEstimate；来源只给官方、核验有效的 http(s) 网址
//
// 二、签名：美国 → 北京每个请求带 x-sync-time（毫秒时间）和 x-sync-signature（HMAC-SHA256(时间.正文)，十六进制），
//    用两台共用的同步秘钥（SYNC_SECRET，和登录令牌的密钥分开）。北京只认 5 分钟以内的，抓到的旧请求不能重放。
//   签名(秘钥, 时间, 正文) → 十六进制
//   验签(秘钥, 时间, 正文, 签名, { now }) → { ok: true } 或 { ok: false, 原因: 缺签名 | 已过期 | 签名不对 }
import crypto from 'node:crypto';

export const 比赛公开字段 = ['aliases', 'website', 'organizer', 'region', 'professions', 'objective_tags', 'lifecycle', 'recognition', 'curation_list'];
export const 届次公开字段 = [
  'edition_name', 'edition_year', 'edition_ordinal', 'level', 'organizer',
  'participants', 'eligibility', 'format_and_rules', 'participation_format', 'team_size', 'team_size_category',
  'registration_method', 'registration_organization', 'registration_url', 'fees', 'fee_type',
  'competition_start', 'competition_end', 'pending_announcement', 'status_override', 'status_override_reason', 'time_note',
  'track_name', 'track_scope_note',
  'reward_amount', 'reward_tier', 'reward_highlights', 'rewards', 'participant_count', 'participant_unit', 'scale_tier', 'participant_scale',
  'last_verified_at',
];
const 推荐公开字段 = ['recommendation', 'reasons', 'suitable_for', 'limitations', 'preparation', 'confidence'];
const 海报文件名 = /^[0-9a-f]{64}\.jpg$/;
export const 时间头 = 'x-sync-time';
export const 签名头 = 'x-sync-signature';
export const 有效毫秒 = 5 * 60 * 1000;

const 挑出 = (记录, 字段们) => Object.fromEntries(字段们.filter(字段 => 记录[字段] !== undefined && 记录[字段] !== null).map(字段 => [字段, 记录[字段]]));

export function 整理比赛(c) {
  return { id: c.id, version: c.version, name: c.name, level: c.level, data: 挑出(c, 比赛公开字段) };
}

function 公开推荐(推荐) {
  if (!推荐 || typeof 推荐 !== 'object') return null;
  const 留下 = 挑出(推荐, 推荐公开字段);
  if (Array.isArray(留下.reasons)) 留下.reasons = 留下.reasons.slice(0, 3);
  return Object.keys(留下).length ? 留下 : null;
}

export function 整理届次(e, 来源们 = []) {
  const data = 挑出(e, 届次公开字段);
  const 推荐 = 公开推荐(e.recommendation);
  if (推荐) data.recommendation = 推荐;
  if (海报文件名.test(e.poster?.file ?? '')) data.poster = { file: e.poster.file };
  const 预计 = e.next_edition_estimate || e.legacy?.nextEditionEstimate;
  if (e.status === '已归档' && 预计) data.next_edition_estimate = 预计;
  const 来源 = 来源们.filter(s => s.is_official && s.validity_status === 'valid' && /^https?:\/\//i.test(s.url || ''))
    .map(s => ({ id: s.id, source_type: s.source_type, url: s.url }));
  if (来源.length) data.sources = 来源;
  return {
    id: e.id, competition_id: e.competition_id, version: e.version,
    registration_start: e.registration_start ?? null, registration_end: e.registration_end ?? null, status: e.status, data,
  };
}

function 检查秘钥(秘钥) {
  if (typeof 秘钥 !== 'string' || 秘钥.length < 32) throw new Error('同步秘钥没配或太短（至少 32 个字符）');
}

export function 签名(秘钥, 时间, 正文) {
  检查秘钥(秘钥);
  return crypto.createHmac('sha256', 秘钥).update(`${时间}.${正文}`).digest('hex');
}

export function 验签(秘钥, 时间, 正文, 签, { now = Date.now() } = {}) {
  检查秘钥(秘钥);
  if (!时间 || !签 || typeof 签 !== 'string') return { ok: false, 原因: '缺签名' };
  if (!/^\d+$/.test(String(时间)) || Math.abs(Number(now) - Number(时间)) > 有效毫秒) return { ok: false, 原因: '已过期' };
  const 应该 = Buffer.from(签名(秘钥, 时间, 正文), 'hex');
  const 实际 = Buffer.from(签, 'hex');
  return 应该.length === 实际.length && crypto.timingSafeEqual(应该, 实际) ? { ok: true } : { ok: false, 原因: '签名不对' };
}
