// 图片总库：比赛海报和候选图的文件，放在美国服务器硬盘上（默认 DB_DIR/海报/，可用 POSTER_DIR 另指）。
// 比赛库的届次只记文件名（poster.file、poster_candidates[].file）；文件名 = 图片内容的 sha256 + 扩展名，同一张图重复存只有一个文件。
// 从旧代码 cloudfunctions/adminData/posterImage.js 搬来，规则不变（2026-10-24 用户定）：
//   海报：640×360 的 JPG、60 KB 以内（后台网页先缩放压缩，这里再查一遍，不合格拒收）
//   候选：不是 16:9 的原图，任意比例、5 MB 以内，只留着备查，不给学生看
//
//   存(内容, 种类, { 目录 })  种类 '海报' 或 '候选' → { 文件, 格式, 宽, 高, 字节, 是海报比例 }
//   读(文件, { 目录 })        → { 文件, 格式, 内容 }；文件名格式不对、没有这张图都报错
//   有(文件, { 目录 })        → 是否；文件名格式不对的算没有
//   文件名格式、海报文件名格式、海报规格、海报比例范围
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { 图片大小, 是海报比例, 海报规格, 内容哈希 } from '../../../共用/工具/图片.mjs';

export { 海报规格, 海报比例范围 } from '../../../共用/工具/图片.mjs';

export const 文件名格式 = /^[0-9a-f]{64}\.(jpg|png|webp)$/;
export const 海报文件名格式 = /^[0-9a-f]{64}\.jpg$/;

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const 默认目录 = () => process.env.POSTER_DIR || path.join(process.env.DB_DIR || path.join(HERE, '..', '数据'), '海报');

function 检查(内容, 种类) {
  const 大小 = 图片大小(内容);
  if (!大小) throw new Error('读不出这张图（只收 JPG、PNG、WebP）');
  if (种类 === '海报') {
    if (大小.格式 !== 'jpg') throw new Error('海报要是 JPG');
    if (大小.宽 !== 海报规格.宽 || 大小.高 !== 海报规格.高) throw new Error(`海报要是 ${海报规格.宽}×${海报规格.高}，这张是 ${大小.宽}×${大小.高}`);
    if (内容.length > 海报规格.最大字节) throw new Error('海报要在 60 KB 以内');
  } else if (种类 === '候选') {
    if (内容.length > 海报规格.候选最大字节) throw new Error('候选图要在 5 MB 以内');
  } else {
    throw new Error(`没有这种种类：${种类}（只有 海报、候选）`);
  }
  return 大小;
}

export function 存(内容, 种类, { 目录 = 默认目录() } = {}) {
  const 大小 = 检查(内容, 种类);
  const 文件 = `${内容哈希(内容)}.${大小.格式}`;
  fs.mkdirSync(目录, { recursive: true });
  const 目标 = path.join(目录, 文件);
  if (!fs.existsSync(目标)) fs.writeFileSync(目标, 内容);
  return { 文件, 格式: 大小.格式, 宽: 大小.宽, 高: 大小.高, 字节: 内容.length, 是海报比例: 是海报比例(大小.宽, 大小.高) };
}

export function 有(文件, { 目录 = 默认目录() } = {}) {
  return typeof 文件 === 'string' && 文件名格式.test(文件) && fs.existsSync(path.join(目录, 文件));
}

export function 读(文件, { 目录 = 默认目录() } = {}) {
  if (typeof 文件 !== 'string' || !文件名格式.test(文件)) throw new Error('图片文件名不对');
  const 目标 = path.join(目录, 文件);
  if (!fs.existsSync(目标)) throw new Error(`图片总库里没有这张图：${文件}`);
  return { 文件, 格式: 文件.split('.').pop(), 内容: fs.readFileSync(目标) };
}
