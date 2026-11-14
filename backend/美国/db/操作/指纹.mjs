// 指纹记录（page_fingerprint）：每个比赛一份，新维护用（2026-11-08 用户定）。只管算指纹、比对和存取，不读网页。
// 指纹只看通知条目的链接和标题（去空白后排序再算 sha1）：计数器、当天日期、随机内容不在条目里，不会误报；和顺序、日期无关。
//
//   算指纹(条目们) → 40 位十六进制
//   比对(旧, 新条目们) → { 第一次, 变了, 新增: [条目], 新指纹 }     旧是 读() 的结果或 null；新增按链接算
//   读(db, 比赛编号) → { 比赛, version, 列表页, etag, 最后修改, 指纹, 条目们, 检查时间, 变化时间 } 或 null
//   记(db, 比赛编号, { 列表页, etag, 最后修改, 条目们, 时间 }) → { id, version, 变了 }   没有就新建；指纹变了才改变化时间；条目最多存 100 条
//   记检查(db, 比赛编号, 时间) → { id, version }                 网站说没更新（304）时只改检查时间
import crypto from 'node:crypto';
import { DbError } from '../../../共用/db/index.mjs';

const 表 = 'page_fingerprint';
const 最多条目 = 100;
const 净 = s => String(s ?? '').replace(/\s+/g, '');

export function 算指纹(条目们 = []) {
  const 行们 = [...new Set((条目们 || []).map(x => `${净(x.链接)}\t${净(x.标题)}`))].sort();
  return crypto.createHash('sha1').update(行们.join('\n')).digest('hex');
}

export function 比对(旧, 新条目们 = []) {
  const 新指纹 = 算指纹(新条目们);
  if (!旧) return { 第一次: true, 变了: true, 新增: 新条目们, 新指纹 };
  const 见过 = new Set((旧.条目们 || []).map(x => 净(x.链接)));
  const 变了 = 新指纹 !== 旧.指纹;
  return { 第一次: false, 变了, 新增: 变了 ? 新条目们.filter(x => !见过.has(净(x.链接))) : [], 新指纹 };
}

export function 读(db, 比赛编号) {
  const 行 = db.get(表, 比赛编号);
  if (!行) return null;
  const d = 行.data;
  return { 比赛: 比赛编号, version: 行.version, 列表页: d.list_url, etag: d.etag ?? null, 最后修改: d.last_modified ?? null, 指纹: d.hash, 条目们: d.items || [],
    检查时间: d.checked_at, 变化时间: d.changed_at };
}

export function 记(db, 比赛编号, { 列表页, etag = null, 最后修改 = null, 条目们 = [], 时间 = new Date().toISOString() } = {}) {
  const 存的 = (条目们 || []).slice(0, 最多条目).map(x => ({ 标题: String(x.标题 || ''), 链接: String(x.链接 || ''), 日期: String(x.日期 || '') }));
  const hash = 算指纹(存的);
  return db.transaction(tx => {
    const 行 = tx.get(表, 比赛编号);
    const 内容 = { list_url: 列表页, etag, last_modified: 最后修改, hash, items: 存的, checked_at: 时间 };
    if (!行) {
      if (!tx.get('competition', 比赛编号, { 包括已删除: true })) throw new DbError('找不到', `没有比赛 ${比赛编号}`, { table: 'competition', id: 比赛编号 });
      const 回 = tx.insert(表, 比赛编号, { ...内容, changed_at: 时间 });
      return { id: 回.id, version: 回.version, 变了: true };
    }
    const 变了 = 行.data.hash !== hash;
    const 回 = tx.update(表, 比赛编号, { ...内容, changed_at: 变了 ? 时间 : 行.data.changed_at }, 行.version);
    return { id: 回.id, version: 回.version, 变了 };
  });
}

export function 记检查(db, 比赛编号, 时间 = new Date().toISOString()) {
  return db.transaction(tx => {
    const 行 = tx.get(表, 比赛编号);
    if (!行) throw new DbError('找不到', `比赛 ${比赛编号} 还没有指纹记录`, { table: 表, id: 比赛编号 });
    const 回 = tx.update(表, 比赛编号, { checked_at: 时间 }, 行.version);
    return { id: 回.id, version: 回.version };
  });
}
