// 测试用：只造图片文件头（JPG 的 SOF0 段、PNG 的 IHDR、WebP 的 VP8X），读宽高的代码只看文件头，不需要真图。
export function 假JPG(宽, 高, 总字节 = 1000) {
  const 头 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 高 >> 8, 高 & 0xff, 宽 >> 8, 宽 & 0xff, 0x03]);
  return Buffer.concat([头, Buffer.alloc(Math.max(0, 总字节 - 头.length), 0x11)]);
}
export function 假PNG(宽, 高) {
  const b = Buffer.alloc(40);
  b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(宽, 16); b.writeUInt32BE(高, 20);
  return b;
}
export function 假WebP(宽, 高) {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1'); b.write('VP8X', 12, 'latin1');
  b.writeUIntLE(宽 - 1, 24, 3); b.writeUIntLE(高 - 1, 27, 3);
  return b;
}
