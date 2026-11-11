// Word：读出 .docx 里的文字。只提供函数，由 读网页 调用。老式 .doc（二进制）不支持。
// 搬自 crawler/lib/extract.mjs 的 extractDocxText：docx 是一个 zip 包，正文在 word/document.xml，用 Node 自带的 zlib 解压，不引入新库。
//
//   Word文字(body) → 文字，段落之间换行；不是 docx、坏文件抛错
import zlib from 'node:zlib';

const 整理空白 = text => String(text || '').replace(/[\t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/[ ]{2,}/g, ' ').trim();

export function Word文字(body) {
  if (!body || body.length < 22 || body.readUInt32LE(0) !== 0x04034b50) throw new Error('不是 docx（不是 zip 包）');
  // 从末尾找“中央目录结束”记录
  let eocd = -1;
  for (let i = body.length - 22; i >= Math.max(0, body.length - 65557); i -= 1) {
    if (body.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('docx 坏了：找不到 zip 目录');
  const entries = body.readUInt16LE(eocd + 10);
  let offset = body.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries && offset + 46 <= body.length; n += 1) {
    if (body.readUInt32LE(offset) !== 0x02014b50) break;
    const method = body.readUInt16LE(offset + 10);
    const compressedSize = body.readUInt32LE(offset + 20);
    const nameLength = body.readUInt16LE(offset + 28);
    const extraLength = body.readUInt16LE(offset + 30);
    const commentLength = body.readUInt16LE(offset + 32);
    const localOffset = body.readUInt32LE(offset + 42);
    const name = body.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (name !== 'word/document.xml') continue;
    const dataStart = localOffset + 30 + body.readUInt16LE(localOffset + 26) + body.readUInt16LE(localOffset + 28);
    const raw = body.subarray(dataStart, dataStart + compressedSize);
    const xml = (method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');
    return 整理空白(xml.replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, ' ').replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'));
  }
  throw new Error('docx 里没有 word/document.xml');
}
