// Codex：命令行参数、结果文件、用量、出错归类、超时结束进程。用假的进程，不真的起 Codex。
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { PassThrough } from 'node:stream';
import { describe, expect, test } from 'vitest';
import { tempRoot } from '../../../../../../共用/test/复用/临时目录.mjs';
import { createCodex } from '../../index.mjs';

// 假进程：按 args 里 -o 的位置写结果文件，往 stdout 写事件流，然后以 code 退出；hang 为 true 时一直不退出
function fakeSpawn({ answer = '{"ok":true}', events = [{ type: 'turn.completed', usage: { input_tokens: 30, output_tokens: 7 } }], code = 0, hang = false } = {}) {
  const calls = [];
  const spawnImpl = (bin, args, options = {}) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.pid = 1234;
    const call = { bin, args, env: options.env, killed: [], prompt: '' };
    calls.push(call);
    child.stdin.on('data', c => { call.prompt += c; });
    child.kill = sig => { call.killed.push(sig); setImmediate(() => child.emit('close', null)); };
    if (!hang) setImmediate(() => {
      const out = args[args.indexOf('-o') + 1];
      if (answer != null) fs.writeFileSync(out, answer);
      child.stdout.end(events.map(e => JSON.stringify(e)).join('\n') + '\n');
      child.stderr.end('');
      setTimeout(() => child.emit('close', code), 5);
    });
    return child;
  };
  return { calls, spawnImpl };
}
const make = (f, extra = {}) => createCodex({ spawnImpl: f.spawnImpl, tmpRoot: tempRoot('codex-test-'), ...extra });

describe('Codex 对话', () => {
  // 2026-11-03 线上实测：新系统为了软链接设了 NODE_OPTIONS=--preserve-symlinks-main，传给 Codex 后它（/usr/bin/codex 也是软链接）找不到自己的安装包，起来就退出码 1
  test('起 Codex 时不把本进程的 NODE_OPTIONS 传下去，其余环境变量照传', async () => {
    const 原来 = { NODE_OPTIONS: process.env.NODE_OPTIONS, 试: process.env.CODEX_TEST_MARK };
    process.env.NODE_OPTIONS = '--preserve-symlinks-main';
    process.env.CODEX_TEST_MARK = '留着';
    try {
      const f = fakeSpawn();
      await make(f).chat({ messages: [] });
      expect(f.calls[0].env).toBeDefined();
      expect(f.calls[0].env.NODE_OPTIONS).toBeUndefined();
      expect(f.calls[0].env.CODEX_TEST_MARK).toBe('留着');
    } finally {
      if (原来.NODE_OPTIONS === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = 原来.NODE_OPTIONS;
      if (原来.试 === undefined) delete process.env.CODEX_TEST_MARK; else process.env.CODEX_TEST_MARK = 原来.试;
    }
  });
  test('只读沙箱、关掉命令行工具、默认关内置搜索；带模型、推理强度、schema；读回结果文件和用量', async () => {
    const f = fakeSpawn();
    const out = await make(f).chat({ model: 'gpt-6.1-sol', effort: 'xhigh', messages: [{ role: 'user', content: '追溯' }], schema: { type: 'object' } });
    const args = f.calls[0].args;
    expect(args.slice(0, 5)).toEqual(['exec', '-m', 'gpt-6.1-sol', '-c', 'model_reasoning_effort="xhigh"']);
    for (const flag of ['--sandbox', 'read-only', 'shell_tool', 'unified_exec', 'web_search="disabled"', '--ephemeral', '--json', '--output-schema']) expect(args).toContain(flag);
    expect(f.calls[0].prompt).toContain('"content":"追溯"');
    expect(out).toEqual({ message: { role: 'assistant', content: '{"ok":true}' }, tokensIn: 30, tokensOut: 7 });
  });
  test('打开内置搜索时不加关闭项', async () => {
    const f = fakeSpawn();
    await make(f).chat({ messages: [], codexSearch: true });
    expect(f.calls[0].args).not.toContain('web_search="disabled"');
  });
  test('订阅额度不足报“额度用完”；退出码不是 0 报“对方出错”；没有结果文件报“格式不对”', async () => {
    await expect(make(fakeSpawn({ code: 1, events: [{ type: 'error', message: 'usage limit reached' }] })).chat({ messages: [] })).rejects.toMatchObject({ kind: '额度用完' });
    await expect(make(fakeSpawn({ code: 2 })).chat({ messages: [] })).rejects.toMatchObject({ kind: '对方出错' });
    await expect(make(fakeSpawn({ answer: null })).chat({ messages: [] })).rejects.toMatchObject({ kind: '格式不对' });
  });
  test('超时：先温和结束进程，报“超时”；临时文件夹清掉', async () => {
    const root = tempRoot('codex-test-');
    const f = fakeSpawn({ hang: true });
    await expect(createCodex({ spawnImpl: f.spawnImpl, tmpRoot: root, timeoutMs: 20, killGraceMs: 20 }).chat({ messages: [] })).rejects.toMatchObject({ kind: '超时' });
    expect(f.calls[0].killed[0]).toBe('SIGTERM');
    expect(fs.readdirSync(root)).toEqual([]);
  });
  test('命令行没装：报“请求有误”，不重试', async () => {
    const spawnImpl = () => {
      const c = new EventEmitter();
      c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.stdin = new PassThrough(); c.kill = () => {};
      setImmediate(() => c.emit('error', Object.assign(new Error('nope'), { code: 'ENOENT' })));
      return c;
    };
    const err = await createCodex({ spawnImpl, tmpRoot: tempRoot('codex-test-') }).chat({ messages: [] }).catch(e => e);
    expect(err).toMatchObject({ kind: '请求有误' });
    expect(err.retryable).toBe(false);
  });
});
