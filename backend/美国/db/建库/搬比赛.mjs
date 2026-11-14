// 建库 · 写进新库：把 转换.mjs 排好的计划用一个事务写进比赛库，任何一条出错整个撤回，库保持原样。
//   搬比赛(计划, db) → { 比赛, 届次, 来源, 处理记录, 搜索记忆 }   写完后库里各表的条数
// 每个比赛顺带写一份初始的搜索记忆（2026-11-07：有官网的写上域名并注明还没核实，其余留空）。
import { 初始 } from '../操作/搜索记忆.mjs';

export function 搬比赛(计划, db) {
  db.transaction(tx => {
    for (const { id, data } of 计划.比赛们) tx.insert('competition', id, data);
    for (const { id, data } of 计划.届次们) tx.insert('edition', id, data);
    for (const { id, data } of 计划.来源们) tx.insert('source', id, data);
    for (const { id, data } of 计划.处理记录们) tx.insert('process_log', id, data);
    for (const { id, data } of 计划.比赛们) tx.insert('search_memory', id, { content: 初始(data), updated_by: '建库' });
  });
  return { 比赛: db.count('competition'), 届次: db.count('edition'), 来源: db.count('source'), 处理记录: db.count('process_log'), 搜索记忆: db.count('search_memory') };
}
