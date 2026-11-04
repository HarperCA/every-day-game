// 图片工具：只读文件头拿格式和宽高（不解码整张图，不装图片库），判断是不是 16:9 海报。美国图片总库和北京收海报都用这一份。
// 从旧代码 cloudfunctions/adminData/posterImage.js 的 readImageSize、isPosterRatio 搬来，逻辑不变。
//   图片大小(buffer)      → { 格式: 'jpg'|'png'|'webp', 宽, 高 }；读不出给 null
//   是海报比例(宽, 高)     宽高比 1.76～1.79（16:9，海报比例范围）
//   海报规格              海报 640×360 的 JPG、60 KB 以内；候选 5 MB 以内、最多 10 张（2026-10-24 用户定）
//   内容哈希(buffer)       sha256 十六进制：图片的文件名就是它
import crypto from 'node:crypto';

export const 海报规格 = { 宽: 640, 高: 360, 最大字节: 60 * 1024, 候选最大字节: 5 * 1024 * 1024, 最多候选: 10 };
export const 海报比例范围 = { 比例下限: 1.76, 比例上限: 1.79 };
const { 比例下限, 比例上限 } = 海报比例范围;

export const 是海报比例 = (宽, 高) => 宽 > 0 && 高 > 0 && 宽 / 高 >= 比例下限 && 宽 / 高 <= 比例上限;
export const 内容哈希 = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

export function 图片大小(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;
  if (buffer.readUInt32BE(0) === 0x89504e47) return { 格式: 'png', 宽: buffer.readUInt32BE(16), 高: buffer.readUInt32BE(20) };
  if (buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') {
    const 块 = buffer.toString('latin1', 12, 16);
    if (块 === 'VP8X' && buffer.length >= 30) return { 格式: 'webp', 宽: 1 + buffer.readUIntLE(24, 3), 高: 1 + buffer.readUIntLE(27, 3) };
    if (块 === 'VP8 ' && buffer.length >= 30) return { 格式: 'webp', 宽: buffer.readUInt16LE(26) & 0x3fff, 高: buffer.readUInt16LE(28) & 0x3fff };
    if (块 === 'VP8L' && buffer.length >= 25) {
      const 位 = buffer.readUInt32LE(21);
      return { 格式: 'webp', 宽: (位 & 0x3fff) + 1, 高: ((位 >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    // 跳过各段，找到 SOF（0xC0～0xCF，除了 C4、C8、CC）读高、宽
    let 位置 = 2;
    while (位置 + 9 < buffer.length) {
      if (buffer[位置] !== 0xff) { 位置 += 1; continue; }
      const 标记 = buffer[位置 + 1];
      if (标记 === 0xd8 || 标记 === 0x01 || (标记 >= 0xd0 && 标记 <= 0xd7)) { 位置 += 2; continue; }
      const 长度 = buffer.readUInt16BE(位置 + 2);
      if (标记 >= 0xc0 && 标记 <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(标记)) {
        return { 格式: 'jpg', 宽: buffer.readUInt16BE(位置 + 7), 高: buffer.readUInt16BE(位置 + 5) };
      }
      位置 += 2 + 长度;
    }
    return null;
  }
  return null;
}
