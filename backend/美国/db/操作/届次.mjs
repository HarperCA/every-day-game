// 届次（二级）的常用操作。只管存取，不做业务判断（哪些能公开、怎么排推荐，留在用到的地方）。
//
//   search(db, conditions, { limit, offset })   届次和所属比赛一起筛选，返回 [{ edition, competition, level, organizer }]
//     conditions:
//       keyword                 届次全称、比赛名称、别名里包含这段文字
//       levels                  级别在其中；届次没填级别的按比赛的算
//       professions             比赛的适合专业里有其中任一项
//       statuses                届次的状态在其中（已发布、已归档、待人工审核）
//       registrationEndAfter    报名截止不早于这个时间（按实际时刻比）
//       participationFormats    届次的参赛形式在其中（个人赛、团队赛……）
//       feeTypes                届次的费用分档在其中
//       regions                 比赛的地区（省份）在其中；includeNoRegion: true 时没填地区的（国家级、国际级）也算
//     排序：报名截止从早到晚，没填的排最后
//     已删除的届次、已删除比赛下的届次一律不出现（回收站另查）
//   openForRegistration(db, now)   报名还没截止的届次（search 的简写）
// 后台写入（每个在一个事务里，并在后台记录 audit_log 留一条；选项 { 操作人, at }）：
//   可改字段                               后台能改的字段：给用户看的那些，加上海报和候选图（状态另用 改状态）
//   新建(db, 比赛id, 内容, 选项)             挂在没删的比赛下，顺序接着最大的往下排（删了的也算），状态默认待人工审核
//   编辑(db, id, 改动, 版本号, 选项)          只写真正变了的字段，并进 manual_fields → { id, version, data, 改了 }
//   改状态(db, id, 状态, 版本号, 选项)        已发布、已归档、待人工审核；人工改成待人工审核又没理由的补一条理由
//   删除(db, id, 选项)                      只标这一届（进回收站）
//   恢复(db, id, 选项)                      比赛还在回收站时不能单独恢复
//   彻底删除(db, id, { at })                 回收站到期清理用：来源、处理记录连带删
import { DbError, RAW } from '../../../共用/db/index.mjs';
import 届次表 from '../描述/表/比赛数据/届次.mjs';
import * as 图片总库 from '../图片总库/index.mjs';
import { 海报规格 } from '../../../共用/工具/图片.mjs';
import { 全部, 只许可改字段, 变了的字段, 并进人工字段, 记日志, 新编号, 现有 } from './后台写入.mjs';

const escapeLike = text => String(text).replace(/[\\%_]/g, ch => `\\${ch}`);
const marks = list => list.map(() => '?').join(', ');

export function search(db, conditions = {}, { limit = 50, offset = 0 } = {}) {
  const { keyword, levels, professions, statuses, registrationEndAfter, participationFormats, feeTypes, regions, includeNoRegion } = conditions;
  const where = ['e.deleted_at IS NULL', 'c.deleted_at IS NULL'];
  const params = [];
  if (keyword) {
    const like = `%${escapeLike(keyword)}%`;
    where.push(`(e.edition_name LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM json_each(c.aliases) WHERE value LIKE ? ESCAPE '\\'))`);
    params.push(like, like, like);
  }
  if (levels?.length) { where.push(`COALESCE(e.level, c.level) IN (${marks(levels)})`); params.push(...levels); }
  if (professions?.length) { where.push(`EXISTS (SELECT 1 FROM json_each(c.professions) WHERE value IN (${marks(professions)}))`); params.push(...professions); }
  if (statuses?.length) { where.push(`e.status IN (${marks(statuses)})`); params.push(...statuses); }
  if (registrationEndAfter) { where.push('julianday(e.registration_end) >= julianday(?)'); params.push(registrationEndAfter); }
  if (participationFormats?.length) { where.push(`e.participation_format IN (${marks(participationFormats)})`); params.push(...participationFormats); }
  if (feeTypes?.length) { where.push(`e.fee_type IN (${marks(feeTypes)})`); params.push(...feeTypes); }
  if (regions?.length) {
    const inList = `c.region IN (${marks(regions)})`;
    where.push(includeNoRegion ? `(${inList} OR c.region IS NULL OR c.region = '')` : inList);
    params.push(...regions);
  }

  const sql = `SELECT e.id AS edition_id, c.id AS competition_id FROM edition e JOIN competition c ON c.id = e.competition_id
    WHERE ${where.join(' AND ')}
    ORDER BY e.registration_end IS NULL, julianday(e.registration_end), e.id LIMIT ? OFFSET ?`;
  return db[RAW].prepare(sql).all(...params, limit, offset).map(row => {
    const edition = db.get('edition', row.edition_id).data;
    const competition = db.get('competition', row.competition_id).data;
    return { edition, competition, level: edition.level ?? competition.level, organizer: edition.organizer ?? competition.organizer };
  });
}

export function openForRegistration(db, now = new Date(), options) {
  return search(db, { registrationEndAfter: now.toISOString() }, options);
}

export const 可改字段 = [
  'edition_name', 'edition_year', 'edition_ordinal', 'level', 'organizer',
  'participants', 'eligibility', 'format_and_rules', 'participation_format', 'team_size', 'team_size_category',
  'registration_method', 'registration_organization', 'registration_url', 'fees', 'fee_type',
  'registration_start', 'registration_end', 'competition_start', 'competition_end', 'pending_announcement',
  'status_override', 'status_override_reason', 'time_note', 'track_name', 'track_scope_note',
  'reward_amount', 'reward_tier', 'reward_highlights', 'rewards', 'participant_count', 'participant_unit', 'scale_tier', 'participant_scale',
  'recommendation',
  'poster', 'poster_candidates',   // 海报文件放在图片总库，这里只记文件名；格式见 检查海报字段
];
export const 状态们 = 届次表.字段.status.可选值;

const 默认选项 = 选项 => ({ 操作人: '管理员', at: new Date().toISOString(), ...选项 });

// 海报（2026-10-24 用户定，字段沿用旧记录）：poster = { file, source, sourceUrl, updatedAt } 或 null；
// poster_candidates = 最多 10 张 [{ file, width, height, bytes, source, sourceUrl, addedAt }] 或 null。文件在不在图片总库由后台核对。
const 海报来源 = ['manual', 'official'];
const 是字符串 = 值 => typeof 值 === 'string';
function 检查海报字段(改动) {
  const 不对 = 说明 => { throw new DbError('请求有误', `海报字段不对：${说明}`, { table: 'edition' }); };
  const 来源对 = 项 => 海报来源.includes(项.source) && 是字符串(项.sourceUrl);
  if (改动.poster != null) {
    const 项 = 改动.poster;
    if (!图片总库.海报文件名格式.test(项.file ?? '')) 不对('海报文件名要是图片总库里的 哈希.jpg');
    if (!来源对(项) || !是字符串(项.updatedAt)) 不对('海报要有 source（manual 或 official）、sourceUrl、updatedAt');
  }
  if (改动.poster_candidates != null) {
    const 列表 = 改动.poster_candidates;
    if (!Array.isArray(列表) || 列表.length > 海报规格.最多候选) 不对(`候选图是一个列表，最多 ${海报规格.最多候选} 张`);
    for (const 项 of 列表) {
      const 数字对 = ['width', 'height', 'bytes'].every(键 => Number.isInteger(项?.[键]));
      if (!图片总库.文件名格式.test(项?.file ?? '') || !数字对 || !来源对(项) || !是字符串(项.addedAt)) 不对('候选图要有 file、width、height、bytes、source、sourceUrl、addedAt');
    }
  }
}
const 版本要对 = (原, 版本号, id) => {
  if (原.version !== 版本号) throw new DbError('版本冲突', `届次 ${id} 已被改过：读到第 ${版本号} 版，现在是第 ${原.version} 版`, { table: 'edition', id });
};

export function 新建(db, 比赛id, 内容, 选项) {
  const { 操作人, at } = 默认选项(选项);
  只许可改字段('edition', 内容, 可改字段);
  检查海报字段(内容);
  return db.transaction(tx => {
    现有(tx, 'competition', 比赛id, '比赛');
    const 已有顺序 = tx.find('edition', { competition_id: 比赛id }, 全部).map(e => e.ordinal);
    const id = 新编号('edition');
    const 回 = tx.insert('edition', id, { ...内容, competition_id: 比赛id, ordinal: Math.max(0, ...已有顺序) + 1, created_by: 操作人, updated_by: 操作人, manual_fields: Object.keys(内容) });
    记日志(tx, '新建届次', 'edition', id, { 名称: 内容.edition_name, 比赛: 比赛id, 操作人 }, at);
    return 回;
  });
}

export function 编辑(db, id, 改动, 版本号, 选项) {
  const { 操作人, at } = 默认选项(选项);
  只许可改字段('edition', 改动, 可改字段);
  检查海报字段(改动);
  return db.transaction(tx => {
    const 原 = 现有(tx, 'edition', id, '届次');
    版本要对(原, 版本号, id);
    const 改了 = 变了的字段(原.data, 改动);
    if (!改了.length) return { id, version: 原.version, data: 原.data, 改了 };
    const 只改这些 = Object.fromEntries(改了.map(字段 => [字段, 改动[字段]]));
    const 回 = tx.update('edition', id, { ...只改这些, updated_by: 操作人, manual_fields: 并进人工字段(原.data.manual_fields, 改了) }, 版本号);
    记日志(tx, '编辑届次', 'edition', id, { 名称: 回.data.edition_name, 改了, 操作人 }, at);
    return { ...回, 改了 };
  });
}

export function 改状态(db, id, 状态, 版本号, 选项) {
  const { 操作人, at } = 默认选项(选项);
  if (!状态们.includes(状态)) throw new DbError('请求有误', `没有这种状态：${状态}（只有 ${状态们.join('、')}）`, { table: 'edition', id });
  return db.transaction(tx => {
    const 原 = 现有(tx, 'edition', id, '届次');
    版本要对(原, 版本号, id);
    if (原.data.status === 状态) return { id, version: 原.version, data: 原.data };
    const 改动 = { status: 状态, status_at: at, updated_by: 操作人, manual_fields: 并进人工字段(原.data.manual_fields, ['status']) };
    // 待人工审核必须有理由
    if (状态 === '待人工审核' && !原.data.status_reason?.length) 改动.status_reason = [`${操作人}在后台改为待人工审核`];
    const 回 = tx.update('edition', id, 改动, 版本号);
    记日志(tx, '改状态', 'edition', id, { 名称: 原.data.edition_name, 从: 原.data.status, 改成: 状态, 操作人 }, at);
    return 回;
  });
}

// 每日归档（维护/归档/，2026-11-03）：已发布 → 已归档，记状态时间、理由、下一届预计，留一条“自动归档”后台记录。要不要归、下一届怎么算由维护/归档/定。
export function 归档(db, id, 版本号, { 下一届预计 = null } = {}, 选项) {
  const { 操作人, at } = 默认选项(选项);
  return db.transaction(tx => {
    const 原 = 现有(tx, 'edition', id, '届次');
    版本要对(原, 版本号, id);
    if (原.data.status !== '已发布') throw new DbError('请求有误', `只归档已发布的届次：${id} 现在是${原.data.status}`, { table: 'edition', id });
    const 回 = tx.update('edition', id, { status: '已归档', status_at: at, status_reason: ['报名已截止，每日归档自动归档'], next_edition_estimate: 下一届预计, updated_by: 操作人 }, 版本号);
    记日志(tx, '自动归档', 'edition', id, { 名称: 原.data.edition_name, 下一届预计, 操作人 }, at);
    return 回;
  });
}

export function 删除(db, id, 选项) {
  const { 操作人, at } = 默认选项(选项);
  return db.transaction(tx => {
    现有(tx, 'edition', id, '届次');
    const 回 = tx.标记删除('edition', id, { by: 操作人, at });
    记日志(tx, '标记删除届次', 'edition', id, { 名称: 回.data.edition_name, 比赛: 回.data.competition_id, 操作人 }, at);
    return {};
  });
}

export function 恢复(db, id, 选项) {
  const { 操作人, at } = 默认选项(选项);
  return db.transaction(tx => {
    const 届次 = tx.get('edition', id, 全部);
    if (!届次?.data.deleted_at) throw new DbError('找不到', `回收站里没有届次 ${id}`, { table: 'edition', id });
    if (!tx.get('competition', 届次.data.competition_id)) {
      throw new DbError('请求有误', `这一届所在的比赛 ${届次.data.competition_id} 也在回收站里，先恢复比赛`, { table: 'edition', id });
    }
    tx.取消删除('edition', id);
    // 人工从回收站恢复的待审届次，算人工定的，AI 审查不再把它删回去（2026-11-07）
    const 恢复后 = tx.get('edition', id);
    if (恢复后.data.status === '待人工审核') tx.update('edition', id, { manual_fields: 并进人工字段(恢复后.data.manual_fields, ['status']) }, 恢复后.version);
    记日志(tx, '恢复届次', 'edition', id, { 名称: 届次.data.edition_name, 比赛: 届次.data.competition_id, 操作人 }, at);
    return {};
  });
}

export function 彻底删除(db, id, 选项) {
  const { at } = 默认选项(选项);
  return db.transaction(tx => {
    const 届次 = tx.get('edition', id, 全部);
    if (!届次?.data.deleted_at) throw new DbError('找不到', `回收站里没有届次 ${id}（没删的不能彻底删除）`, { table: 'edition', id });
    const { 连带 } = tx.彻底删除('edition', id);
    记日志(tx, '回收站清理', 'edition', id, { 名称: 届次.data.edition_name, 比赛: 届次.data.competition_id, 标记时间: 届次.data.deleted_at, 标记人: 届次.data.deleted_by, 连带 }, at);
    return { 连带 };
  });
}
