import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { classifyApi, createRecorder, errorCode, parseUsage } from '../scripts/server/api-usage.mjs';

const require = createRequire(import.meta.url);
const { buildApiUsageReport, callerLabel } = require('../apps/miniprogram/cloudfunctions/adminData/apiUsageReport.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'api-usage-'));
const lines = dir => fs.readdirSync(dir).flatMap(name => fs.readFileSync(path.join(dir, name), 'utf8').trim().split('\n').map(line => JSON.parse(line)));
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

describe('接口用量记账', () => {
  it('按网址认接口，其他网络请求不记', () => {
    expect(classifyApi('https://qianfan.baidubce.com/v2/ai_search/web_search')).toBe('baidu_search');
    expect(classifyApi('https://api.kimi.com/coding/v1/chat/completions')).toBe('kimi_chat');
    expect(classifyApi('https://api.kimi.com/coding/v1/search')).toBe('kimi_search');
    expect(classifyApi('https://api.kimi.com/coding/v1/fetch')).toBe('kimi_fetch');
    expect(classifyApi('https://api.deepseek.com/chat/completions')).toBe('deepseek');
    expect(classifyApi('https://openrouter.ai/api/v1/chat/completions')).toBe('openrouter');
    expect(classifyApi('https://api.weixin.qq.com/sns/jscode2session')).toBe('wechat');
    expect(classifyApi('https://culsc.cn/#/Home')).toBeNull();
  });

  it('从返回里取 token、费用和错误码（流式取最后一次 usage）', () => {
    expect(parseUsage('{"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15,"cost":0.0012}}')).toEqual({ tokensIn:10, tokensOut:5, tokens:15, costUsd:0.0012 });
    expect(parseUsage('data: {"usage":{"total_tokens":3}}\ndata: {"usage":{"prompt_tokens":7,"completion_tokens":2,"total_tokens":9}}').tokens).toBe(9);
    expect(parseUsage('{"references":[]}').tokens).toBeNull();
    expect(errorCode(429, '{"code": "QUOTA_USER_DAILY_FREE"}')).toBe('QUOTA_USER_DAILY_FREE');
    expect(errorCode(200, '{"errcode":40001,"errmsg":"invalid credential"}')).toBe('errcode_40001');
    expect(errorCode(403, '{}')).toBe('http_403');
  });

  it('记下使用位置，可以细分一层；业务拿到的返回不受影响', async () => {
    const dir = tmp();
    const recorder = createRecorder({ dir, defaultCaller:'run-extract' });
    const fake = async url => new Response(/kimi/.test(url) ? '{"usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120}}' : '<html></html>', { status:200 });
    const fetch = recorder.wrap(fake);
    await fetch('https://culsc.cn/');
    const body = await recorder.run('adminData.runScheduledAiReview', () => recorder.run('处置代理', async () => (await fetch('https://api.kimi.com/coding/v1/chat/completions')).text()));
    expect(body).toContain('usage');
    await fetch('https://api.weixin.qq.com/cgi-bin/token');
    await settle();
    const entries = lines(dir);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ api:'kimi_chat', caller:'adminData.runScheduledAiReview › 处置代理', ok:true, tokens:120, tokensIn:100, tokensOut:20 });
    expect(entries[1]).toMatchObject({ api:'wechat', caller:'run-extract', ok:true });
  });

  it('失败和网络错误也记，错误照常抛给业务', async () => {
    const dir = tmp();
    const recorder = createRecorder({ dir, defaultCaller:'search-baidu' });
    await recorder.wrap(async () => new Response('{"code": "QUOTA_USER_DAILY_FREE"}', { status:429 }))('https://qianfan.baidubce.com/v2/ai_search/web_search');
    await recorder.wrap(async () => new Response('{"errcode":40001}', { status:200 }))('https://api.weixin.qq.com/cgi-bin/message/subscribe/send');
    await expect(recorder.wrap(async () => { throw new Error('socket hang up'); })('https://api.deepseek.com/chat/completions')).rejects.toThrow('socket');
    await settle();
    // 网络错误当场记，其余等正文读完再记，先后顺序不固定
    expect(lines(dir).map(entry => [entry.api, entry.ok, entry.error]).sort()).toEqual([
      ['baidu_search', false, 'QUOTA_USER_DAILY_FREE'], ['deepseek', false, 'network_error'], ['wechat', false, 'errcode_40001']]);
  });
});

describe('接口用量报表', () => {
  it('Codex CLI 用量有独立分类，失败也计入实际已使用 token，不冒充剩余额度', () => {
    const dir = tmp();
    const recorder = createRecorder({ dir, now:() => new Date('2026-10-13T04:00:00Z') });
    recorder.write({ api:'codex_cli', caller:'notice-agent', ok:true, tokens:500, tokensIn:450, tokensOut:50 });
    recorder.write({ api:'codex_cli', caller:'notice-agent', ok:false, tokens:100, tokensIn:80, tokensOut:20, error:'codex_invalid_decision' });
    const report = buildApiUsageReport({ days:1, now:new Date('2026-10-13T04:00:00Z'), dir });
    expect(report.days[0].apis.codex_cli).toMatchObject({ calls:2, ok:1, failed:1, tokens:600 });
    expect(report.details[0]).toMatchObject({ apiLabel:'Codex CLI', callerLabel:'通知追溯代理', tokensIn:530, tokensOut:70 });
    expect(report.apis.find(item => item.id === 'codex_cli').quota).toContain('不代表账户剩余额度');
  });
  it('按天 × 接口汇总，按接口 × 使用位置细分，并带百度当天自动用量', () => {
    const root = tmp();
    const dir = path.join(root, 'api-usage');
    fs.mkdirSync(dir);
    const write = (date, entries) => fs.writeFileSync(path.join(dir, `${date}.jsonl`), entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
    write('2026-10-10', [
      { at:'2026-10-09T17:01:00Z', api:'baidu_search', caller:'search-baidu', ok:true, ms:800 },
      { at:'2026-10-09T17:02:00Z', api:'baidu_search', caller:'search-baidu', ok:false, error:'QUOTA_USER_DAILY_FREE', ms:200 },
      { at:'2026-10-09T17:10:00Z', api:'kimi_chat', caller:'notice-agent', ok:true, tokens:5000, tokensIn:4000, tokensOut:1000, ms:9000 },
      { at:'2026-10-09T18:00:00Z', api:'openrouter', caller:'run-crawl-pipeline', ok:true, costUsd:0.0021, ms:500 },
    ]);
    write('2026-10-09', [{ at:'2026-10-09T03:00:00Z', api:'kimi_chat', caller:'adminData.runScheduledAiReview › 处置代理', ok:true, tokens:100 }]);
    fs.writeFileSync(path.join(root, 'baidu-usage.json'), JSON.stringify({ date:'2026-10-10', auto:2, manual:1, byCaller:{ nightly:2 } }));
    const report = buildApiUsageReport({ days:3, now:new Date('2026-10-10T04:00:00Z'), dir });
    expect(report.dates).toEqual(['2026-10-10', '2026-10-09', '2026-10-08']);
    expect(report.days[0]).toMatchObject({ total:4, apis:{ baidu_search:{ calls:2, ok:1, failed:1 }, kimi_chat:{ calls:1, tokens:5000 }, openrouter:{ costUsd:0.0021 } } });
    expect(report.days[2]).toEqual({ date:'2026-10-08', total:0, apis:{} });
    const baidu = report.details.find(row => row.date === '2026-10-10' && row.api === 'baidu_search');
    expect(baidu).toMatchObject({ callerLabel:'夜间百度搜索', calls:2, failed:1, errors:[{ code:'QUOTA_USER_DAILY_FREE', count:1 }], avgMs:500 });
    expect(report.details.find(row => row.date === '2026-10-09').callerLabel).toBe('定时 AI 审核 › 处置代理');
    expect(report.baiduToday).toMatchObject({ auto:2, manual:1, limit:30 });
    expect(report.since).toBe('2026-10-09');
    expect(callerLabel('some-new-script')).toBe('some-new-script');
  });
});
