// 读网页换线路（2026-11-07 用户定，照旧系统 fetchEvidenceUrl、beijing-page-reader.mjs）：服务器在美国，部分国内网站连不上、超时或 403，这时改由北京服务器读。
// 只有网络层面打不开才换；412 这类反爬、404、robots 不允许是对方明确的答复，不换。旧系统的上海中转不搬（上海要下线）。
// 北京读网页程序报的 404 不算数：2026-11-07 实测 caa.org.cn 能打开，它却报 404，不能据此删比赛、换链接，交回美国的结果下次再试。
// 北京那边是受限的 ssh 命令：/opt/daily-contest/reader/beijing-reader-stdio.mjs，只收一个公开网址、交回正文，不碰业务数据。
//
//   加北京线路(直读, 问北京) → 读网页(网址, 选项)     交回和 美国/web 的 读网页 一样的形状，走了北京的多一个 线路: '北京'
//   北京客户端({ 主机, 密钥, spawnImpl, 超时毫秒, 最大字节 }) → 问北京(网址, { signal })
//   从环境造读网页(直读, env)                        BEIJING_READER_HOST、BEIJING_READER_KEY 都配了才换线路，否则就是直读
import { spawn } from 'node:child_process';

const 值得换 = 结果 => ['超时', '网络错误'].includes(结果.status) || (结果.status === 'HTTP错误' && 结果.httpStatus === 403);
const 页面状态 = /^(ok|blocked|error|timeout|too_short|network_error|invalid_url|unsupported_protocol|unsupported_type|too_large|too_many_redirects|http_\d{3})$/;

function 合格(值) {
  if (!值 || typeof 值 !== 'object' || Array.isArray(值) || !页面状态.test(值.status || '') || typeof 值.text !== 'string' || 值.text.length > 12000) throw new Error('beijing_reader_invalid_response');
  if (值.links !== undefined && (!Array.isArray(值.links) || 值.links.length > 10 || 值.links.some(l => typeof l?.url !== 'string' || typeof l?.text !== 'string'))) throw new Error('beijing_reader_invalid_response');
  return 值;
}

export function 北京客户端({ 主机, 密钥, spawnImpl = spawn, 超时毫秒 = 45000, 收尾毫秒 = 1000, 最大字节 = 128 * 1024 }) {
  return (网址, { signal } = {}) => new Promise((resolve, reject) => {
    const child = spawnImpl('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=yes', '-i', 密钥, 主机], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const 收到 = [];
    let 字节 = 0, 出错 = null, 结束了 = false, 强杀, 兜底;
    const 收尾 = (错, 值) => {
      if (结束了) return;
      结束了 = true;
      clearTimeout(定时); clearTimeout(强杀); clearTimeout(兜底);
      signal?.removeEventListener('abort', 中断);
      if (错) reject(错); else resolve(值);
    };
    const 停 = 错 => {
      if (出错 || 结束了) return;
      出错 = 错;
      clearTimeout(定时);
      child.kill();
      强杀 = setTimeout(() => {
        child.kill('SIGKILL');
        if (!结束了) 兜底 = setTimeout(() => 收尾(出错), 收尾毫秒);
      }, 收尾毫秒);
    };
    const 中断 = () => 停(new Error('beijing_reader_aborted'));
    signal?.addEventListener('abort', 中断, { once: true });
    const 定时 = setTimeout(() => 停(new Error('beijing_reader_timeout')), 超时毫秒);
    const 数 = 块 => {
      字节 += 块.length;
      if (字节 > 最大字节) { 停(new Error('beijing_reader_output_limit')); return false; }
      return true;
    };
    child.stdout.on('data', 块 => { if (!出错 && !结束了 && 数(块)) 收到.push(Buffer.from(块)); });
    child.stderr.on('data', 块 => { if (!出错 && !结束了) 数(块); });
    child.stdin.on('error', () => {});   // ssh 失败在 close 时一起算
    child.once('error', () => 收尾(new Error('beijing_reader_spawn_error')));
    child.once('close', code => {
      if (出错) { 收尾(出错); return; }
      if (code !== 0) { 收尾(new Error(`beijing_reader_exit_${code}`)); return; }
      try { 收尾(null, 合格(JSON.parse(Buffer.concat(收到).toString('utf8')))); } catch (错) { 收尾(错 instanceof SyntaxError ? new Error('beijing_reader_invalid_response') : 错); }
    });
    child.stdin.end(JSON.stringify({ url: 网址 }));
  });
}

// 北京的结果换成 读网页 的形状；用不上的交回 null（用美国的结果，写明北京也试过）
function 换算(网址, 页) {
  const 共有 = { url: 网址, finalUrl: 页.finalUrl || 网址, httpStatus: null, contentType: '', title: '', text: 页.text || '', links: (页.links || []).map(l => ({ url: l.url, text: l.text, kind: '其他' })), error: '', fetchedAt: new Date().toISOString(), 线路: '北京' };
  if (页.status === 'ok') return { ...共有, status: '成功' };
  if (页.status === 'too_short') return { ...共有, status: '正文太短', error: '北京读到的正文太短' };
  if (页.status === 'blocked') return { ...共有, status: 'robots不允许', error: '网站的 robots.txt 不允许抓取' };
  return null;
}

export function 加北京线路(直读, 问北京) {
  return async (网址, 选项 = {}) => {
    const 直 = await 直读(网址, 选项);
    if (!值得换(直)) return 直;
    let 说明;
    try {
      const 页 = await 问北京(网址, { signal: 选项.signal });
      const 结果 = 换算(网址, 页);
      if (结果) return 结果;
      说明 = 页.error || 页.status;
    } catch (错) {
      说明 = 错?.message || String(错);
    }
    return { ...直, error: `${直.error}；北京也读不到：${说明}`.slice(0, 300) };
  };
}

export function 从环境造读网页(直读, env = process.env) {
  if (!env.BEIJING_READER_HOST || !env.BEIJING_READER_KEY) return 直读;
  return 加北京线路(直读, 北京客户端({ 主机: env.BEIJING_READER_HOST, 密钥: env.BEIJING_READER_KEY }));
}
