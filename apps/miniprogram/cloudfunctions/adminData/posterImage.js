// 比赛海报（2026-10-24 用户定）：
// - 只收 16:9：宽高比在 1.76～1.79 之间才能设为海报；不是的进这场比赛的候选图片，只留着备查，不进公开数据。
// - 海报文件 640 × 360、JPG、60 KB 以内（后台网页里先缩放压缩，这里再查一遍，不合格拒收）。
// - 图片总库放美国服务器硬盘，文件名用内容哈希；每 5 分钟的同步把海报一张一请求推到上海云存储，
//   换回 https 链接写进上海的公开数据（scripts/server/sync-public-cache.mjs）。
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const POSTER_WIDTH = 640;
const POSTER_HEIGHT = 360;
const POSTER_MAX_BYTES = 60 * 1024;
const CANDIDATE_MAX_BYTES = 5 * 1024 * 1024;
const RATIO_MIN = 1.76;
const RATIO_MAX = 1.79;
const MAX_CANDIDATES = 10;
const FILE_PATTERN = /^[0-9a-f]{64}\.(jpg|png|webp)$/;
const POSTER_FILE_PATTERN = /^[0-9a-f]{64}\.jpg$/;

// 服务器上默认放在 /opt/daily-contest/server/data/posters（函数目录 /opt/daily-contest/functions/adminData 往上两级）
function posterDir() {
  return process.env.POSTER_DIR || path.join(__dirname, '..', '..', 'server', 'data', 'posters');
}

const isPosterRatio = (width, height) => width > 0 && height > 0 && width / height >= RATIO_MIN && width / height <= RATIO_MAX;

// 从文件头读格式和宽高（JPG / PNG / WebP），读不出来返回 null
function readImageSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;
  if (buffer.readUInt32BE(0) === 0x89504e47) return { type:'png', width:buffer.readUInt32BE(16), height:buffer.readUInt32BE(20) };
  if (buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') {
    const chunk = buffer.toString('latin1', 12, 16);
    if (chunk === 'VP8X' && buffer.length >= 30) return { type:'webp', width:1 + buffer.readUIntLE(24, 3), height:1 + buffer.readUIntLE(27, 3) };
    if (chunk === 'VP8 ' && buffer.length >= 30) return { type:'webp', width:buffer.readUInt16LE(26) & 0x3fff, height:buffer.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L' && buffer.length >= 25) {
      const bits = buffer.readUInt32LE(21);
      return { type:'webp', width:(bits & 0x3fff) + 1, height:((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    // 跳过各段，找到 SOF（0xC0～0xCF，除了 C4 / C8 / CC）读高、宽
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type:'jpg', width:buffer.readUInt16BE(offset + 7), height:buffer.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
    return null;
  }
  return null;
}

function decodeBase64Image(data) {
  if (typeof data !== 'string' || !data) throw new Error('poster_image_required');
  const raw = data.replace(/^data:image\/[a-z]+;base64,/i, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(raw)) throw new Error('poster_image_invalid');
  return Buffer.from(raw, 'base64');
}

// 检查一张图能不能存：海报必须是 640×360 的 JPG、60 KB 以内；候选可以是任意比例的 JPG/PNG/WebP、5 MB 以内
function checkImage(buffer, kind) {
  const size = readImageSize(buffer);
  if (!size) throw new Error('poster_image_unreadable');
  if (kind === 'poster') {
    if (size.type !== 'jpg') throw new Error('poster_must_be_jpg');
    if (size.width !== POSTER_WIDTH || size.height !== POSTER_HEIGHT) throw new Error('poster_must_be_640x360');
    if (buffer.length > POSTER_MAX_BYTES) throw new Error('poster_too_large');
  } else if (kind === 'candidate') {
    if (buffer.length > CANDIDATE_MAX_BYTES) throw new Error('poster_candidate_too_large');
  } else {
    throw new Error('poster_kind_invalid');
  }
  return size;
}

// 存进图片总库：文件名 = 内容的 sha256 + 扩展名；同一张图重复上传得到同一个文件名
function savePosterImage(data, kind, dir = posterDir()) {
  const buffer = decodeBase64Image(data);
  const size = checkImage(buffer, kind);
  const file = `${crypto.createHash('sha256').update(buffer).digest('hex')}.${size.type}`;
  fs.mkdirSync(dir, { recursive:true });
  const target = path.join(dir, file);
  if (!fs.existsSync(target)) fs.writeFileSync(target, buffer);
  return { file, width:size.width, height:size.height, bytes:buffer.length, ratioOk:isPosterRatio(size.width, size.height) };
}

// 后台预览：按文件名读回图片（只认总库里的文件名格式，不能读别的路径）
function readPosterImage(file, dir = posterDir()) {
  if (typeof file !== 'string' || !FILE_PATTERN.test(file)) throw new Error('poster_file_invalid');
  const target = path.join(dir, file);
  if (!fs.existsSync(target)) throw new Error('poster_file_not_found');
  const type = file.endsWith('.png') ? 'png' : file.endsWith('.webp') ? 'webp' : 'jpeg';
  return { file, dataUrl:`data:image/${type};base64,${fs.readFileSync(target).toString('base64')}` };
}

// 公开数据里只放海报文件名（同步时换成上海的 https 链接），文件名格式不对就当没有海报
function publicPosterFile(record) {
  const file = record?.poster?.file;
  return typeof file === 'string' && POSTER_FILE_PATTERN.test(file) ? file : '';
}

module.exports = {
  POSTER_WIDTH, POSTER_HEIGHT, POSTER_MAX_BYTES, CANDIDATE_MAX_BYTES, RATIO_MIN, RATIO_MAX, MAX_CANDIDATES, POSTER_FILE_PATTERN,
  posterDir, isPosterRatio, readImageSize, checkImage, savePosterImage, readPosterImage, publicPosterFile,
};
