import { describe, expect, it } from 'vitest';
import { binarySourceText } from '../scripts/server/run-extract.mjs';

describe('官网主网址为 PDF 或 DOCX', () => {
  it('抽取 PDF，并在正文中保留最终来源网址', async () => {
    const url = 'https://contest.example.edu.cn/2026/rules.pdf';
    const body = Buffer.from('%PDF-test');
    const text = await binarySourceText({ status:'ok', body, finalUrl:url }, 'https://example.edu.cn/redirect', {
      pdf:async received => {
        expect(received).toBe(body);
        return { text:'第二十届竞赛报名截止时间为2026年10月10日。', status:'ok' };
      },
    });
    expect(text).toContain(`来源文件：${url}`);
    expect(text).toContain('报名截止时间为2026年10月10日');
  });

  it('抽取 DOCX，并拒绝伪装成附件的未知内容', async () => {
    const url = 'https://contest.example.edu.cn/2026/rules.docx';
    expect(await binarySourceText({ status:'ok', body:Buffer.from('PK-test') }, url, {
      docx:() => ({ text:'官方报名章程', status:'ok' }),
    })).toContain('官方报名章程');
    expect(await binarySourceText({ status:'ok', body:Buffer.from('not a document') }, url)).toBe('');
    expect(await binarySourceText({ status:'fetch_failed', body:Buffer.from('%PDF-test') }, url)).toBe('');
  });
});
