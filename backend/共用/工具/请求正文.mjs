// 读请求正文（2026-11-03）：先把字节收齐，最后一次转成文字；上限按字节算。
// 不能逐块转文字再拼：一个汉字（UTF-8 三个字节）正好切在两块之间就成了乱码。部署时美国推公开比赛到北京，带中文的那批因此签名对不上。
//   读正文(请求, 上限字节) → { 正文 } 或 { 太大: true }（超过上限就不再往下读）
export async function 读正文(请求, 上限字节) {
  const 块们 = [];
  let 字节数 = 0;
  for await (const 块 of 请求) {
    字节数 += 块.length;
    if (字节数 > 上限字节) return { 太大: true };
    块们.push(块);
  }
  return { 正文: Buffer.concat(块们).toString('utf8') };
}
