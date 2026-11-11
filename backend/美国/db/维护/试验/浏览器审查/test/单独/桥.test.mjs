// 桥：Codex 起的 MCP 进程，把 tools/call 转给试跑进程（本机 socket）。真的起一个子进程、走真的 JSON-RPC。
import { spawn } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';

const 桥文件 = fileURLToPath(new URL('../../桥.mjs', import.meta.url));
const 收尾 = [];
afterEach(async () => { for (const f of 收尾.splice(0)) await f(); });

async function 假服务(回答) {
  const 地址 = process.platform === 'win32' ? `\\\\.\\pipe\\桥测试-${process.pid}-${Date.now()}` : path.join(os.tmpdir(), `bridge-${process.pid}-${Date.now()}.sock`);
  const 收到 = [];
  const server = http.createServer((req, res) => {
    let 体 = '';
    req.on('data', c => { 体 += c; });
    req.on('end', () => { const 值 = JSON.parse(体); 收到.push(值); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(回答(值))); });
  });
  await new Promise(r => server.listen(地址, r));
  收尾.push(() => new Promise(r => server.close(r)));
  return { 地址, 收到 };
}

function 起桥(地址, 轮号) {
  const child = spawn(process.execPath, [桥文件, 地址, 轮号], { stdio: ['pipe', 'pipe', 'pipe'] });
  收尾.push(() => { child.kill(); });
  let 缓存 = '';
  const 等着 = new Map();
  child.stdout.on('data', c => {
    缓存 += c;
    let i;
    while ((i = 缓存.indexOf('\n')) >= 0) {
      const 行 = 缓存.slice(0, i); 缓存 = 缓存.slice(i + 1);
      if (!行.trim()) continue;
      const 值 = JSON.parse(行);
      等着.get(值.id)?.(值);
    }
  });
  const 问 = (id, method, params) => new Promise(resolve => { 等着.set(id, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  return { 问, child };
}

describe('MCP 桥', () => {
  test('initialize 照回协议版本，声明有工具', async () => {
    const { 地址 } = await 假服务(() => ({}));
    const { 问 } = 起桥(地址, 'r1');
    const 回 = await 问(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(回.result.protocolVersion).toBe('2025-06-18');
    expect(回.result.capabilities.tools).toBeTruthy();
  });
  test('tools/list 只有搜索和读页', async () => {
    const { 地址 } = await 假服务(() => ({}));
    const { 问 } = 起桥(地址, 'r1');
    const 回 = await 问(2, 'tools/list', {});
    expect(回.result.tools.map(t => t.name).sort()).toEqual(['read_page', 'search']);
    for (const t of 回.result.tools) expect(t.inputSchema.type).toBe('object');
  });
  test('tools/call 带轮号转给服务，文字原样交回', async () => {
    const { 地址, 收到 } = await 假服务(() => ({ 文字: '结果一', 出错: false }));
    const { 问 } = 起桥(地址, 'r7');
    const 回 = await 问(3, 'tools/call', { name: 'search', arguments: { query: '大赛' } });
    expect(收到[0]).toEqual({ 轮号: 'r7', 工具: 'search', 参数: { query: '大赛' } });
    expect(回.result).toEqual({ content: [{ type: 'text', text: '结果一' }], isError: false });
  });
  test('服务说出错：isError 为真', async () => {
    const { 地址 } = await 假服务(() => ({ 文字: '次数用完', 出错: true }));
    const { 问 } = 起桥(地址, 'r1');
    expect((await 问(4, 'tools/call', { name: 'read_page', arguments: {} })).result.isError).toBe(true);
  });
  test('服务连不上：isError，桥不退出', async () => {
    const { 问, child } = 起桥(process.platform === 'win32' ? '\\\\.\\pipe\\没有这个' : '/tmp/没有这个.sock', 'r1');
    expect((await 问(5, 'tools/call', { name: 'read_page', arguments: {} })).result.isError).toBe(true);
    expect(child.exitCode).toBe(null);
  });
  test('不认识的方法回错误，ping 回空', async () => {
    const { 地址 } = await 假服务(() => ({}));
    const { 问 } = 起桥(地址, 'r1');
    expect((await 问(6, 'nope', {})).error.code).toBe(-32601);
    expect((await 问(7, 'ping', {})).result).toEqual({});
  });
});
