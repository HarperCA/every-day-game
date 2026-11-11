// PDF：读出 PDF 里的文字（不少比赛的正式通知是附件）。只提供函数，由 读网页 调用。
// 搬自 crawler/lib/extract.mjs 的 extractPdfText。注意要引 pdf-parse 的内部实现而不是包入口：
// pdf-parse 1.1.1 的 index.js 里残留了一段调试代码，导入时会去读 ./test/data/05-versions-space.pdf，正常安装下必定找不到文件。
//
// 还要先复制一份从头开始的数据再交给它：Node 里小的 Buffer 是从一块共用内存里切出来的（起点不在 0），
// pdf-parse 带的旧版 pdf.js 不认这个起点，会读到错位的字节，报“bad XRef entry”（2026-11-01 测试时发现，文件越小越容易碰上）。
//
//   PDF文字(body) → 文字；读不出抛错
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../Environment/package.json', import.meta.url));
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

const 整理空白 = text => String(text || '').replace(/[\t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/[ ]{2,}/g, ' ').trim();

export async function PDF文字(body) {
  if (!body?.length) throw new Error('PDF 是空的');
  const parsed = await pdfParse(new Uint8Array(body));
  return 整理空白(parsed.text);
}
