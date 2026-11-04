// 比赛（一级）的常用操作。只管存取，不做业务判断。
//   findByName(db, text)                  名称或别名完全一样的比赛
//   editionsOf(db, id)                    某个比赛的全部届次，按届次顺序
//   全部连届次(db)                         没删的比赛，各带上没删的届次（按届次顺序）；后台列表读这个
// 后台写入（每个在一个事务里，并在后台记录 audit_log 留一条；选项 { 操作人, at }）：
//   可改字段                               后台能改的字段：给用户看的那些
//   新建(db, 内容, 选项)                    生成编号，填了的字段记进 manual_fields → { id, version, data }
//   编辑(db, id, 改动, 版本号, 选项)          只写真正变了的字段，并进 manual_fields → { id, version, data, 改了 }
//   删除(db, id, { 不再收录, 理由, ...选项 })  比赛和它没删的届次一起标删除（进回收站）；不再收录的记进不收录名单 → { 届次 }
//   恢复(db, id, 选项)                      比赛和跟它同一次删的届次回来，不收录名单里的去掉 → { 届次 }
//   彻底删除(db, id, { at })                 回收站到期清理用：届次、来源、处理记录连带删，下级比赛断开上级
import { DbError } from '../../../共用/db/index.mjs';
import { 全部, 只许可改字段, 变了的字段, 并进人工字段, 记日志, 新编号, 现有 } from './后台写入.mjs';

export const 可改字段 = ['name', 'aliases', 'website', 'level', 'organizer', 'region', 'professions', 'objective_tags', 'lifecycle', 'recognition', 'curation_list'];

const 默认选项 = 选项 => ({ 操作人: '管理员', at: new Date().toISOString(), ...选项 });

export function findByName(db, text) {
  return db.find('competition', { or: [{ name: text }, { aliases: { contains: text } }] }, { orderBy: 'id' });
}

export function editionsOf(db, id) {
  return db.find('edition', { competition_id: id }, { orderBy: 'ordinal' });
}

export function 全部连届次(db) {
  const 按比赛 = new Map();
  for (const e of db.find('edition', {}, { orderBy: 'ordinal' })) {
    if (!按比赛.has(e.competition_id)) 按比赛.set(e.competition_id, []);
    按比赛.get(e.competition_id).push(e);
  }
  return db.find('competition', {}, { orderBy: 'id' }).map(c => ({ ...c, 届次们: 按比赛.get(c.id) || [] }));
}

export function 新建(db, 内容, 选项) {
  const { 操作人, at } = 默认选项(选项);
  只许可改字段('competition', 内容, 可改字段);
  return db.transaction(tx => {
    const id = 新编号('event');
    const 回 = tx.insert('competition', id, { ...内容, manual_fields: Object.keys(内容) });
    记日志(tx, '新建比赛', 'competition', id, { 名称: 内容.name, 操作人 }, at);
    return 回;
  });
}

export function 编辑(db, id, 改动, 版本号, 选项) {
  const { 操作人, at } = 默认选项(选项);
  只许可改字段('competition', 改动, 可改字段);
  return db.transaction(tx => {
    const 原 = 现有(tx, 'competition', id, '比赛');
    const 改了 = 变了的字段(原.data, 改动);
    if (原.version !== 版本号) throw new DbError('版本冲突', `比赛 ${id} 已被改过：读到第 ${版本号} 版，现在是第 ${原.version} 版`, { table: 'competition', id });
    if (!改了.length) return { id, version: 原.version, data: 原.data, 改了 };
    const 只改这些 = Object.fromEntries(改了.map(字段 => [字段, 改动[字段]]));
    const 回 = tx.update('competition', id, { ...只改这些, manual_fields: 并进人工字段(原.data.manual_fields, 改了) }, 版本号);
    记日志(tx, '编辑比赛', 'competition', id, { 名称: 回.data.name, 改了, 操作人 }, at);
    return { ...回, 改了 };
  });
}

export function 删除(db, id, { 不再收录 = false, 理由 = null, ...选项 } = {}) {
  const { 操作人, at } = 默认选项(选项);
  return db.transaction(tx => {
    const 比赛 = 现有(tx, 'competition', id, '比赛');
    const 届次们 = tx.find('edition', { competition_id: id });
    for (const e of 届次们) tx.标记删除('edition', e.id, { by: 操作人, at });
    tx.标记删除('competition', id, { by: 操作人, at });
    if (不再收录) {
      const { name, aliases, website } = 比赛.data;
      tx.insert('blocked_competition', `blocked-${id}`, { name, aliases, website, competition_id: id, reason: 理由, created_at: at, created_by: 操作人 });
    }
    记日志(tx, '标记删除比赛', 'competition', id, { 名称: 比赛.data.name, 届次: 届次们.length, 操作人, 不再收录, 理由 }, at);
    return { 届次: 届次们.length };
  });
}

export function 恢复(db, id, 选项) {
  const { 操作人, at } = 默认选项(选项);
  return db.transaction(tx => {
    const 比赛 = tx.get('competition', id, 全部);
    if (!比赛?.data.deleted_at) throw new DbError('找不到', `回收站里没有比赛 ${id}`, { table: 'competition', id });
    // 只恢复跟比赛同一次删的届次；之前单独删的，删除时间不同，留在回收站
    const 一起删的 = tx.find('edition', { competition_id: id, deleted_at: 比赛.data.deleted_at }, 全部);
    for (const e of 一起删的) tx.取消删除('edition', e.id);
    tx.取消删除('competition', id);
    for (const b of tx.find('blocked_competition', { competition_id: id })) tx.remove('blocked_competition', b.id);
    记日志(tx, '恢复比赛', 'competition', id, { 名称: 比赛.data.name, 届次: 一起删的.length, 操作人 }, at);
    return { 届次: 一起删的.length };
  });
}

export function 彻底删除(db, id, 选项) {
  const { at } = 默认选项(选项);
  return db.transaction(tx => {
    const 比赛 = tx.get('competition', id, 全部);
    if (!比赛?.data.deleted_at) throw new DbError('找不到', `回收站里没有比赛 ${id}（没删的不能彻底删除）`, { table: 'competition', id });
    const { 连带, 断开 } = tx.彻底删除('competition', id);
    记日志(tx, '回收站清理', 'competition', id, { 名称: 比赛.data.name, 标记时间: 比赛.data.deleted_at, 标记人: 比赛.data.deleted_by, 连带,
      断开的下级比赛: 断开.filter(x => x.表 === 'competition').map(x => x.编号) }, at);
    return { 连带, 断开 };
  });
}
