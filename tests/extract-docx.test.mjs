// 平台附件常是 Word（.docx）：参赛对象、资格、赛制都写在附件里，要能读出文字
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { extractDocxText } from '../scripts/crawler/lib/extract.mjs';

// 拼一个最小的 zip：本地文件头 + 数据，中央目录，目录结束记录
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = zlib.deflateRawSync(Buffer.from(content, 'utf8'));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

describe('读 Word 附件', () => {
  it('取出 word/document.xml 里的段落文字并还原转义', () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>参赛对象：全日制在校本科生</w:t></w:r></w:p><w:p><w:r><w:t>每队3&lt;=人数</w:t></w:r></w:p></w:body></w:document>';
    const result = extractDocxText(zip({ '[Content_Types].xml':'<Types/>', 'word/document.xml':xml }));
    expect(result.status).toBe('ok');
    expect(result.text).toContain('参赛对象：全日制在校本科生');
    expect(result.text).toContain('每队3<=人数');
  });
  it('不是 docx、或缺正文时给出原因而不是抛错', () => {
    expect(extractDocxText(Buffer.from('%PDF-1.4 xxxxxxxxxxxxxxxxxxxxxxxx')).status).toBe('not_docx');
    expect(extractDocxText(zip({ 'other.xml':'<a/>' })).status).toBe('no_document_xml');
  });
});
