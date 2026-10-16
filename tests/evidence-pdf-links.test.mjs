// 读网页程序（competitionAiReview.js 的 fetchEvidenceUrl，Kimi 审核、三项核验、处置代理共用）：
// 2026-10-10 起保留页面里的文件链接、把 PDF 抽成文字（“外教社杯”章程原先读到的是 %PDF 原始字节）
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { fetchEvidenceUrl } = require('../apps/miniprogram/cloudfunctions/adminData/competitionAiReview.js');
const { runKimiResolutionAgent } = require('../apps/miniprogram/cloudfunctions/adminData/kimiResolutionAgent.js');

import fs from 'node:fs';
// pdf-parse 自带的样例 PDF（夜间抓取装的那份），正文是 “Dadfrtfjh,mgf v.0.01”
const samplePdf = () => fs.readFileSync(new URL('../scripts/crawler/node_modules/pdf-parse/test/data/05-versions-space.pdf', import.meta.url));
const reply = (body, type) => ({ ok:true, status:200, url:'', headers:{ get:() => type }, arrayBuffer:async () => body, text:async () => body.toString('utf8') });
const send = pages => async url => url.endsWith('/robots.txt') ? { ok:false, status:404, headers:{ get:() => '' }, text:async () => '' } : pages[url];

describe('读网页：文件链接和 PDF', () => {
  it('把“在线浏览/下载pdf”和页面嵌入的文件整理成链接，相对地址补全', async () => {
    const html = Buffer.from(`<html><body><h1>国赛章程</h1><p>第九届大赛</p>
      <a href="https://cdn.example.com/2026/rules.pdf" target="_blank"><span>在线浏览</span></a>
      <a href="/uploadfile/2025/old.pdf"><span>下载pdf</span></a><a href="/news/1.html">新闻</a>
      <iframe src="/website/notice.pdf"></iframe></body></html>`);
    const item = await fetchEvidenceUrl(send({ 'https://ict.example.cn/rules': reply(html, 'text/html') }), 'https://ict.example.cn/rules', new Map());
    expect(item.status).toBe('reachable');
    expect(item.text).toContain('第九届大赛');
    expect(item.text).toContain('在线浏览：https://cdn.example.com/2026/rules.pdf');
    expect(item.text).toContain('下载pdf：https://ict.example.cn/uploadfile/2025/old.pdf');
    expect(item.text).toContain('页面嵌入的文件：https://ict.example.cn/website/notice.pdf');
    expect(item.text).not.toContain('/news/1.html');
  });
  it('PDF 抽出文字，不再把原始字节交给 Kimi', async () => {
    const item = await fetchEvidenceUrl(send({ 'https://cdn.example.com/rules.pdf': reply(samplePdf(), 'application/pdf') }), 'https://cdn.example.com/rules.pdf', new Map());
    expect(item).toMatchObject({ status:'reachable', format:'pdf' });
    expect(item.text).toContain('Dadfrtfjh');
    expect(item.text).not.toContain('%PDF');
  });
  it('内容类型不对、但内容是 PDF 的也按 PDF 读', async () => {
    const item = await fetchEvidenceUrl(send({ 'https://cdn.example.com/f?id=1': reply(samplePdf(), 'application/octet-stream') }), 'https://cdn.example.com/f?id=1', new Map());
    expect(item.text).toContain('v.0.01');
  });
});

describe('处置代理最后一轮', () => {
  it('最多 8 轮，最后一轮明确要求只交 JSON', async () => {
    const seen = [];
    let turn = 0;
    const callModel = async messages => {
      seen.push(messages[messages.length - 1]);
      turn += 1;
      const tool = turn === 1 ? { name:'web_search', arguments:JSON.stringify({ query:'测试大赛' }) } : { name:'fetch_url', arguments:JSON.stringify({ url:'https://a.example/' }) };
      if (turn < 8) return { content:'', tool_calls:[{ id:`t${turn}`, function:tool }] };
      return { content:JSON.stringify({ outcome:'delete', reason:'确认不是比赛' }) };
    };
    const result = await runKimiResolutionAgent({ name:'测试大赛', sources:[] }, {}, { callModel, config:{ apiKey:'k', model:'m', baseUrl:'x' },
      fetch:async () => ({ status:'reachable', text:'正文' }), search:async () => ({ references:[] }) });
    expect(turn).toBe(8);
    expect(seen[7]).toMatchObject({ role:'user' });
    expect(seen[7].content).toContain('最后一轮');
    expect(result.outcome).toBe('delete');
  });
});
