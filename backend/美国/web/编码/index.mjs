// 编码：把下载下来的网页字节转成正常文字。只提供函数，由 读网页 调用。
// 中文网站大量用 GB2312/GBK，写死 UTF-8 会整页乱码。搬自 crawler/lib/fetcher.mjs 的 detectCharset、decodeBody。
//
//   识别编码(contentType, body) → 'gbk' / 'utf-8' / …   先看响应头，再看网页开头的 meta；gb2312 按 gbk；都没写按 utf-8
//   转文字(body, contentType)   → 文字
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../Environment/package.json', import.meta.url));
const iconv = require('iconv-lite');

export function 识别编码(contentType, body) {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(String(contentType || ''));
  const head = body.subarray(0, 2048).toString('latin1');
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head) || /<meta[^>]+content=["'][^"']*charset=([\w-]+)/i.exec(head);
  const name = (fromHeader?.[1] || fromMeta?.[1] || 'utf-8').toLowerCase().replace(/^x-/, '');
  return name === 'gb2312' || name === 'gb_2312' ? 'gbk' : name;
}

export function 转文字(body, contentType) {
  const charset = 识别编码(contentType, body);
  return iconv.encodingExists(charset) ? iconv.decode(body, charset) : body.toString('utf8');
}
