// 海报导入（2026-11-04 用户定）：把 2026-10-28 已确认的海报包写进图片总库和届次。
// 只有届次对得上的才设为海报，其余进候选（只备查，学生看不到）。对应关系由 海报准备.py 排好，这里只写。
//
//   写海报(db, 项们, { 目录, 读文件, at, 试跑 }) → { 海报, 候选, 跳过: [{ id, 原因 }] }
//     项：{ id, action: '海报'|'候选', target, file, page_url }；读文件(file) 返回图片内容
//     已经有别的海报的不覆盖，转成候选；同一张重复写不算；候选满 10 张就跳过。可以重跑。
import { 届次, 图片总库 } from '../db/index.mjs';

const 操作人 = '海报导入';

export function 写海报(db, 项们, { 目录, 读文件, at = new Date().toISOString(), 试跑 = false } = {}) {
  const 结果 = { 海报: 0, 候选: 0, 跳过: [] };
  for (const 项 of 项们) {
    const 行 = db.get('edition', 项.target);
    if (!行) { 结果.跳过.push({ id: 项.id, 原因: `没有届次 ${项.target}` }); continue; }
    const 现有海报 = 行.data.poster?.file;
    const 候选们 = 行.data.poster_candidates || [];
    if (现有海报 === 项.file || 候选们.some(c => c.file === 项.file)) { 结果.跳过.push({ id: 项.id, 原因: '这张已经写过' }); continue; }
    const 当海报 = 项.action === '海报' && !现有海报;
    if (!当海报 && 候选们.length >= 图片总库.海报规格.最多候选) { 结果.跳过.push({ id: 项.id, 原因: '候选已满' }); continue; }
    const 内容 = 读文件(项.file);
    if (试跑) { 结果[当海报 ? '海报' : '候选'] += 1; continue; }
    const 存了 = 图片总库.存(内容, 当海报 ? '海报' : '候选', { 目录 });
    const 改动 = 当海报
      ? { poster: { file: 存了.文件, source: 'official', sourceUrl: 项.page_url || '', updatedAt: at } }
      : { poster_candidates: [...候选们, { file: 存了.文件, width: 存了.宽, height: 存了.高, bytes: 存了.字节, source: 'official', sourceUrl: 项.page_url || '', addedAt: at }] };
    届次.编辑(db, 项.target, 改动, 行.version, { 操作人, at });
    结果[当海报 ? '海报' : '候选'] += 1;
  }
  return 结果;
}
