// MCP 桥（试验）：Codex 起这个进程，走 stdio 的 JSON-RPC（一行一个）；工具调用经本机 socket 转给试跑进程。
// 浏览器、搜索、读过的网页都在试跑进程里，桥本身没有任何权限，也不读环境变量。
//   node 桥.mjs <socket> <轮号>
import http from 'node:http';
import readline from 'node:readline';
import { 工具定义 } from './工具.mjs';

const [地址, 轮号] = process.argv.slice(2);
const 发 = 值 => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...值 })}\n`);

function 转给服务(工具, 参数) {
  return new Promise(resolve => {
    const req = http.request({ socketPath: 地址, path: '/', method: 'POST', headers: { 'content-type': 'application/json' } }, res => {
      let 体 = '';
      res.setEncoding('utf8');
      res.on('data', c => { 体 += c; });
      res.on('end', () => { try { resolve(JSON.parse(体)); } catch { resolve({ 文字: '工具服务回的内容不对', 出错: true }); } });
    });
    req.on('error', 错 => resolve({ 文字: `工具服务连不上：${错.message}`, 出错: true }));
    req.end(JSON.stringify({ 轮号, 工具, 参数 }));
  });
}

async function 处理(消息) {
  const { id, method, params } = 消息;
  if (id === undefined) return;   // 通知不用回
  if (method === 'initialize') return 发({ id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'radar', version: '1' } } });
  if (method === 'ping') return 发({ id, result: {} });
  if (method === 'tools/list') return 发({ id, result: { tools: 工具定义 } });
  if (method === 'tools/call') {
    const 回 = await 转给服务(params?.name, params?.arguments || {});
    return 发({ id, result: { content: [{ type: 'text', text: String(回.文字 ?? '') }], isError: Boolean(回.出错) } });
  }
  return 发({ id, error: { code: -32601, message: `不支持：${method}` } });
}

readline.createInterface({ input: process.stdin }).on('line', 行 => {
  if (!行.trim()) return;
  let 消息;
  try { 消息 = JSON.parse(行); } catch { return; }
  处理(消息);
});
