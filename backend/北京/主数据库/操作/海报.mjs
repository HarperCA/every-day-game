// 主数据库的海报文件：美国推来的海报存在硬盘上（默认 DB_DIR/海报/，可用 POSTER_DIR 另指），文件名 = 内容的 sha256 + .jpg，和美国图片总库一样。
// 届次的公开内容里只记文件名（data.poster.file）；首页卡片的 poster_url 由 用户呈现模块 按这里有没有文件拼出来。
// 北京是自己的服务器，海报文件夹由网站直接对外提供，不用旧上海那样的 10 分钟临时链接（旧做法是因为云开发免费期不能设公开读）。
//   收(文件, 内容, { 目录 })   只收 640×360 的 JPG、60 KB 以内、文件名和内容哈希对得上的 → { 文件, 新存 }
//   有(文件, { 目录 })         → 是否；文件名格式不对的算没有
//   缺的(db, { 目录 })         届次引用了、这边还没有文件的（美国据此补推）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { 图片大小, 海报规格, 内容哈希 } from '../../../共用/工具/图片.mjs';

const 文件名格式 = /^[0-9a-f]{64}\.jpg$/;
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const 默认目录 = () => process.env.POSTER_DIR || path.join(process.env.DB_DIR || path.join(HERE, '..', '数据'), '海报');

export function 收(文件, 内容, { 目录 = 默认目录() } = {}) {
  if (typeof 文件 !== 'string' || !文件名格式.test(文件)) throw new Error(`海报文件名不对：${文件}`);
  if (内容哈希(内容) !== 文件.slice(0, 64)) throw new Error(`海报内容和文件名对不上（传输出错或被改过）：${文件}`);
  const 大小 = 图片大小(内容);
  if (大小?.格式 !== 'jpg' || 大小.宽 !== 海报规格.宽 || 大小.高 !== 海报规格.高) throw new Error(`海报要是 ${海报规格.宽}×${海报规格.高} 的 JPG：${文件}`);
  if (内容.length > 海报规格.最大字节) throw new Error(`海报要在 60 KB 以内：${文件}`);
  fs.mkdirSync(目录, { recursive: true });
  const 目标 = path.join(目录, 文件);
  if (fs.existsSync(目标)) return { 文件, 新存: false };
  fs.writeFileSync(目标, 内容);
  return { 文件, 新存: true };
}

export function 有(文件, { 目录 = 默认目录() } = {}) {
  return typeof 文件 === 'string' && 文件名格式.test(文件) && fs.existsSync(path.join(目录, 文件));
}

export function 缺的(db, { 目录 = 默认目录() } = {}) {
  const 引用的 = new Set(db.find('public_edition', {}).map(e => e.data?.poster?.file).filter(文件 => 文件名格式.test(文件 ?? '')));
  return [...引用的].filter(文件 => !有(文件, { 目录 }));
}
