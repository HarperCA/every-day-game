// 主数据库的同步：收下美国推来的一批已公开比赛、届次（发送那一端在 backend/沟通/公开比赛同步/）。整批在一个事务里，任何一条不对整批不收。
//
//   收下(db, 批次, { now, 海报目录 }) → { 新增, 更新, 跳过, 下架, 海报 }
//     批次：{ 比赛们: [{ id, version, name, level, data }],
//             届次们: [{ id, competition_id, version, registration_start, registration_end, status, data }],
//             下架届次: [编号], 下架比赛: [编号],
//             海报们: [{ 文件, 内容（base64） }] }    新的海报文件，先存（存不下整批不收），再写库；海报 = 新存了几张
//     version 是美国比赛库里的版本号：比这里存的大才覆盖，一样或更小的跳过（推送重复、乱序都不会改回旧的）；
//     批次带 同版本也覆盖: true（美国每 24 小时整体重推时带）时一样的也覆盖，只跳过更小的
//     下架：美国那边删除、转回待人工审核的；下架比赛连同它的届次一起删；这里没有的不报错
import * as 海报 from '../操作/海报.mjs';

export function 收下(db, 批次 = {}, { now = new Date(), 海报目录 } = {}) {
  const 结果 = { 新增: 0, 更新: 0, 跳过: 0, 下架: 0, 海报: 0 };
  for (const { 文件, 内容 } of 批次.海报们 || []) {
    if (海报.收(文件, Buffer.from(String(内容 || ''), 'base64'), { 目录: 海报目录 }).新存) 结果.海报 += 1;
  }
  const synced_at = now.toISOString();
  const 写入 = (tx, 表, { id, version, ...列 }) => {
    const 现有 = tx.get(表, id)?.data;
    if (!现有) { tx.insert(表, id, { ...列, source_version: version, synced_at }); 结果.新增 += 1; return; }
    if (批次.同版本也覆盖 ? version < 现有.source_version : !(version > 现有.source_version)) { 结果.跳过 += 1; return; }
    tx.update(表, id, { ...列, source_version: version, synced_at });
    结果.更新 += 1;
  };
  db.transaction(tx => {
    for (const 比赛 of 批次.比赛们 || []) 写入(tx, 'public_competition', 比赛);
    for (const 届次 of 批次.届次们 || []) 写入(tx, 'public_edition', 届次);
    for (const id of 批次.下架届次 || []) {
      if (!tx.get('public_edition', id)) continue;
      tx.remove('public_edition', id);
      结果.下架 += 1;
    }
    for (const id of 批次.下架比赛 || []) {
      if (!tx.get('public_competition', id)) continue;
      for (const e of tx.find('public_edition', { competition_id: id })) tx.remove('public_edition', e.id);
      tx.remove('public_competition', id);
      结果.下架 += 1;
    }
  });
  return 结果;
}
