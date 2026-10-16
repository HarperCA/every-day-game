import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { codexChat, validateDecision } from '../scripts/server/codex-agent.mjs';
import { runNoticeAgent } from '../scripts/server/notice-agent.mjs';
import { BAIDU_RECENCY } from '../scripts/server/search-engines.mjs';

const completed={type:'turn.completed',usage:{input_tokens:100,output_tokens:25}};
const finalDecision={content:'{"outcome":"not_competition"}',tool_calls:[]};
const leftovers=[];
const originalRecorder=globalThis.__apiUsage;
afterEach(()=>{
  globalThis.__apiUsage=originalRecorder;
  for(const directory of leftovers.splice(0)) fs.rmSync(directory,{recursive:true,force:true});
});
function fakeSpawn({events=[completed],decision=finalDecision,code=0,onEnd,onKill}={}) {
  const state={signals:[],args:null,directory:null};
  state.spawn=(binary,args,options)=>{
    state.args=args; state.options=options; state.directory=args[args.indexOf('-C')+1];
    const child=new EventEmitter();
    child.pid=12345; child.stdin=new PassThrough(); child.stdout=new PassThrough(); child.stderr=new PassThrough();
    child.kill=signal=>{state.signals.push(signal); if(onKill)onKill(child,signal,state); else queueMicrotask(()=>child.emit('close',null));return true;};
    child.stdin.on('finish',()=>queueMicrotask(()=>{
      if(onEnd)return onEnd(child,state);
      fs.writeFileSync(args[args.indexOf('-o')+1],JSON.stringify(decision));
      child.stdout.write(events.map(event=>JSON.stringify(event)).join('\n')+'\n');
      child.emit('close',code);
    }));
    return child;
  };
  return state;
}

describe('Codex controlled competition agent',()=>{
  it('rejects unknown tools, late tools and invalid arguments',()=>{
    expect(()=>validateDecision({content:'',tool_calls:[{id:'a',function:{name:'delete_file',arguments:'{}'}}]},true)).toThrow('codex_invalid_tool');
    const tool={content:'',tool_calls:[{id:'a',function:{name:'fetch_page',arguments:JSON.stringify({url:'https://official.example/n'})}}]};
    expect(()=>validateDecision(tool,false)).toThrow('codex_tools_after_limit');
    expect(()=>validateDecision({content:'',tool_calls:[{id:'a',function:{name:'fetch_page',arguments:JSON.stringify({url:'file:///secret'})}}]},true)).toThrow('codex_invalid_url');
  });
  it('validates schema keys, unique tool IDs and scoped argument types',()=>{
    expect(()=>validateDecision({...finalDecision,extra:true},true)).toThrow('codex_invalid_decision');
    const search={id:'a',function:{name:'web_search',arguments:'{"query":"比赛","recent":"yesterday"}'}};
    expect(()=>validateDecision({content:'',tool_calls:[search]},true)).toThrow('codex_invalid_query');
    search.function.arguments='{"query":"比赛"}';
    expect(()=>validateDecision({content:'',tool_calls:[search,search]},true)).toThrow('codex_invalid_tool');
    const read={id:'a',function:{name:'fetch_page',arguments:'{"url":"https://official.example","start":-1}'}};
    expect(()=>validateDecision({content:'',tool_calls:[read]},true)).toThrow('codex_invalid_url');
    read.function.arguments='{"url":"https://user:secret@official.example"}';
    expect(()=>validateDecision({content:'',tool_calls:[read]},true)).toThrow('codex_invalid_url');
    read.function.arguments='{"url":"https://"}';
    expect(()=>validateDecision({content:'',tool_calls:[read]},true)).toThrow('codex_invalid_url');
  });
  it('accepts all search recency values, including 180 days, used by the search adapter',()=>{
    expect(BAIDU_RECENCY).toContain('semiyear');
    for(const recent of BAIDU_RECENCY){
      const decision={content:'',tool_calls:[{id:'search',function:{name:'web_search',arguments:JSON.stringify({query:'比赛通知',recent})}}]};
      expect(validateDecision(decision,true)).toBe(decision);
    }
  });
  it('uses isolated controlled CLI flags and records subscription tokens',async()=>{
    const state=fakeSpawn(); const recorded=[];
    globalThis.__apiUsage={current:()=> 'notice-agent',write:entry=>recorded.push(entry)};
    const result=await codexChat([],[],false,{spawnImpl:state.spawn});
    expect(result.used).toBe(125);
    for(const flag of ['--ignore-user-config','--ignore-rules','read-only','shell_tool','unified_exec','web_search="disabled"','--ephemeral','--output-schema'])expect(state.args).toContain(flag);
    expect(state.args.slice(0,5)).toEqual(['exec','-m','gpt-6.1-sol','-c','model_reasoning_effort="xhigh"']);
    expect(state.options.windowsHide).toBe(true);
    expect(fs.existsSync(state.directory)).toBe(false);
    expect(recorded).toEqual([expect.objectContaining({api:'codex_cli',caller:'notice-agent',endpoint:'codex exec',ok:true,tokens:125,tokensIn:100,tokensOut:25})]);
    expect(recorded[0]).not.toHaveProperty('costUsd');
    expect(recorded[0]).not.toHaveProperty('status');
  });
  it('waits for forced termination before deleting the process directory',async()=>{
    const state=fakeSpawn({onEnd:()=>{},onKill:(child,signal,state)=>{
      expect(fs.existsSync(state.directory)).toBe(true);
      if(signal==='SIGKILL') setTimeout(()=>child.emit('close',null),5);
    }});
    await expect(codexChat([],[],false,{spawnImpl:state.spawn,timeoutMs:10,killGraceMs:5,forceKillWaitMs:30})).rejects.toThrow('codex_timeout');
    expect(state.signals).toEqual(['SIGTERM','SIGKILL']);
    expect(fs.existsSync(state.directory)).toBe(false);
  });
  it('bounds a process that never closes and preserves its active directory',async()=>{
    const state=fakeSpawn({onEnd:()=>{},onKill:()=>{}});
    await expect(codexChat([],[],false,{spawnImpl:state.spawn,timeoutMs:5,killGraceMs:5,forceKillWaitMs:5})).rejects.toThrow('codex_timeout:termination_unconfirmed');
    expect(state.signals).toEqual(['SIGTERM','SIGKILL']);
    expect(fs.existsSync(state.directory)).toBe(true);
    leftovers.push(state.directory);
  });
  it('caps output and discards further output after stopping',async()=>{
    const state=fakeSpawn({onEnd:child=>{
      child.stdout.write(Buffer.alloc(2*1024*1024+1));
      child.stdout.write(JSON.stringify(completed)+'\n');
    }});
    const recorded=[];globalThis.__apiUsage={current:()=> 'notice-agent',write:entry=>recorded.push(entry)};
    await expect(codexChat([],[],false,{spawnImpl:state.spawn})).rejects.toThrow('codex_output_too_large');
    expect(state.signals).toEqual(['SIGTERM']);
    expect(recorded[0]).not.toHaveProperty('tokens');
    expect(fs.existsSync(state.directory)).toBe(false);
  });
  it('rejects stdin errors instead of silently waiting for a result',async()=>{
    const state=fakeSpawn({onEnd:child=>child.stdin.emit('error',Object.assign(new Error('broken'),{code:'EPIPE'}))});
    await expect(codexChat([],[],false,{spawnImpl:state.spawn})).rejects.toThrow('codex_stdin_failed:EPIPE');
    expect(state.signals).toEqual(['SIGTERM']);
  });
  it('rejects a failed turn even with exit zero and reports observed usage',async()=>{
    const state=fakeSpawn({events:[completed,{type:'turn.failed',error:{message:'quota exceeded'}}]});
    const recorded=[];globalThis.__apiUsage={current:()=> 'notice-agent',write:entry=>recorded.push(entry)};
    await expect(codexChat([],[],false,{spawnImpl:state.spawn})).rejects.toMatchObject({message:expect.stringContaining('Codex usage limit'),used:125});
    expect(recorded[0]).toMatchObject({ok:false,tokens:125,error:expect.stringContaining('Codex usage limit')});
  });
  it('rejects an oversized output file before loading it',async()=>{
    const state=fakeSpawn({onEnd:(child,state)=>{
      fs.writeFileSync(state.args[state.args.indexOf('-o')+1],Buffer.alloc(2*1024*1024+1));
      child.stdout.write(JSON.stringify(completed)+'\n');child.emit('close',0);
    }});
    await expect(codexChat([],[],false,{spawnImpl:state.spawn})).rejects.toMatchObject({message:'codex_decision_file_invalid',used:125});
  });
  it('rejects invalid event envelopes',async()=>{
    const state=fakeSpawn({events:[null,completed]});
    await expect(codexChat([],[],false,{spawnImpl:state.spawn})).rejects.toThrow('codex_invalid_event_stream');
  });
  it.each(['command_execution','mcp_tool_call','web_search','file_change','collab_tool_call','future_native_tool'])('rejects native tool item %s',async type=>{
    const state=fakeSpawn({events:[{type:'item.completed',item:{type}},completed]});
    await expect(codexChat([],[],false,{spawnImpl:state.spawn})).rejects.toMatchObject({message:'codex_unexpected_native_tool',used:125});
  });
  it.each([undefined,{input_tokens:-1,output_tokens:5},{input_tokens:'100',output_tokens:5},{input_tokens:Infinity,output_tokens:5},{input_tokens:0,output_tokens:0}])('rejects missing or invalid token accounting: %j',async usage=>{
    const state=fakeSpawn({events:[{type:'turn.completed',usage}]});
    await expect(codexChat([],[],false,{spawnImpl:state.spawn})).rejects.toThrow('codex_usage_missing');
  });
  it('runs Codex decisions through existing reads and rejects invented sources',async()=>{
    const official='全国大学生比赛组委会通知。参赛对象为在校大学生。报名截止2026年11月1日。'.repeat(12);
    const decisions=[{content:'',tool_calls:[{id:'a',function:{name:'fetch_page',arguments:'{"url":"https://official.example/notice"}'}}]},
      {content:JSON.stringify({outcome:'found_official',contest_name:'全国大学生比赛',reason:'官方原文',sources:[{url:'https://official.example/notice',evidence:'“报名截止2026年11月1日”'},{url:'https://invented.example/notice',evidence:'“报名截止2026年11月1日”'}]}),tool_calls:[]}];
    const report=await runNoticeAgent([{name:'全国大学生比赛通知',detailUrl:'https://school.example/n'}],{provider:'codex',concurrency:1,searcher:{search:async()=>null},codexDecision:async()=>({data:{choices:[{message:decisions.shift()}]},used:100}),readPage:async url=>({url,finalUrl:url,status:'ok',text:official,links:[]}),log:()=>{}});
    expect(report.method).toBe('codex_agent');
    expect(report.tokens).toBe(200);
    expect(report.results[0].leads.map(item=>item.url)).toEqual(['https://official.example/notice']);
    expect(report.results[0].removedSources).toHaveLength(1);
  });
  it('keeps quota failures retryable instead of recording a completed miss',async()=>{
    const report=await runNoticeAgent([{name:'比赛通知',detailUrl:'https://school.example/n'}],{provider:'codex',concurrency:1,searcher:{search:async()=>null},codexDecision:async()=>{throw Error('Codex usage limit');},log:()=>{}});
    expect(report.results[0].agent.outcome).toBe('skipped_budget');
    expect(report.results[0]).not.toHaveProperty('followupQuery');
    expect(report.stopReason).toContain('Codex');
  });
});
