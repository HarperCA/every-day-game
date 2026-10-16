import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { runKimiResolutionAgent } = require('../apps/miniprogram/cloudfunctions/adminData/kimiResolutionAgent.js');
const url = 'https://organizer.example/notice';
const message = value => ({ content:JSON.stringify(value) });
const resolved = { outcome:'resolved', reason:'官方通知已核对', recordPatch:{ name:'赛事', sources:[{ url, source_type:'organizer_notice', is_official:true, validity_status:'valid', evidence_excerpt:'报名截止10月18日' }] } };
const base = { config:{ model:'test' }, now:() => '2026-10-09T00:00:00Z', fetch:async () => ({ status:'reachable', text:'赛事官方通知 报名截止10月18日' }) };
describe('Kimi resolution agent evidence guards', () => {
  it('returns source verified time from actual reading and strips status writes', async () => {
    const result = await runKimiResolutionAgent({ sources:[{ url }] }, {}, { ...base, callModel:async () => message({ ...resolved, recordPatch:{ ...resolved.recordPatch, dataStatus:'published' } }) });
    expect(result.recordPatch.sources[0].last_verified_at).toBe('2026-10-09T00:00:00Z');
    expect(result.recordPatch.dataStatus).toBeUndefined();
    expect(result.evidence[0].text).toContain('截止');
  });
  it('rejects a model source that was never fetched', async () => {
    await expect(runKimiResolutionAgent({}, {}, { ...base, callModel:async () => message(resolved) })).rejects.toThrow('unverified_source');
  });
  it('rejects fabricated excerpts', async () => {
    await expect(runKimiResolutionAgent({ sources:[{ url }] }, {}, { ...base, fetch:async () => ({ status:'reachable', text:'首页欢迎访问' }), callModel:async () => message(resolved) })).rejects.toThrow('unverified_source');
  });
  it('searches then reads a new official page', async () => {
    let turn = 0;
    const result = await runKimiResolutionAgent({}, {}, { ...base, search:async () => ({ references:[{ url }] }), callModel:async () => turn++ === 0 ? { tool_calls:[{ id:'1', function:{ name:'web_search', arguments:'{"query":"赛事官网"}' } }] } : turn === 2 ? { tool_calls:[{ id:'2', function:{ name:'fetch_url', arguments:JSON.stringify({ url }) } }] } : message(resolved) });
    expect(result.tool_calls.map(item => item.name)).toEqual(['web_search','fetch_url']);
  });
  it('does not turn search infrastructure failure into deletion', async () => {
    await expect(runKimiResolutionAgent({}, {}, { ...base, search:async () => { throw new Error('network'); }, callModel:async () => ({ tool_calls:[{ id:'1', function:{ name:'web_search', arguments:'{"query":"赛事"}' } }] }) })).rejects.toThrow('network');
  });
  it('does not accept deletion after network fetch failure', async () => {
    await expect(runKimiResolutionAgent({ sources:[{ url }] }, {}, { ...base, fetch:async () => ({ status:'unreachable', error:'timeout' }), callModel:async () => message({ outcome:'delete', reason:'没有来源' }) })).rejects.toThrow('infrastructure_failed');
  });
  it('rejects malformed JSON', async () => {
    await expect(runKimiResolutionAgent({}, {}, { ...base, callModel:async () => ({ content:'invalid' }) })).rejects.toThrow('invalid_json');
  });
  it('bounds tool rounds', async () => {
    await expect(runKimiResolutionAgent({}, { maxTurns:1 }, { ...base, search:async () => ({ references:[] }), callModel:async () => ({ tool_calls:[{ id:'1', function:{ name:'web_search', arguments:'{"query":"赛事"}' } }] }) })).rejects.toThrow('max_turns');
  });
  it('feeds rejected excerpts back to the agent for correction', async () => {
    let calls = 0;
    const result = await runKimiResolutionAgent({ sources:[{ url }] }, {}, { ...base, callModel:async messages => {
      if (calls++ === 0) return message({ ...resolved, recordPatch:{ ...resolved.recordPatch, sources:[{ ...resolved.recordPatch.sources[0], evidence_excerpt:'伪造摘录' }] } });
      expect(messages.at(-1).content).toContain('来源校验未通过');
      return message(resolved);
    } });
    expect(result.outcome).toBe('resolved');
    expect(calls).toBe(2);
  });
  it('asks for missing source metadata before rejecting a correction', async () => {
    let calls = 0;
    const result = await runKimiResolutionAgent({ sources:[{ url }] }, {}, { ...base, callModel:async messages => {
      if (calls++ === 0) return message({ ...resolved, recordPatch:{ name:'赛事' } });
      expect(messages.at(-1).content).toContain('recordPatch.sources缺失');
      return message(resolved);
    } });
    expect(result.recordPatch.sources).toHaveLength(1);
  });
});
