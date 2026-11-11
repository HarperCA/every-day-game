// 用户数据同步（北京服务器这一端，2026-11-02）：把北京用户库、报错库推一份到美国的只读副本，给美国后台的访问异常、问卷统计、意见反馈、纠错审核看。
// 做法和公开比赛同步一样（../公开比赛同步/美国端.mjs，方向相反）：
//   - 只推有变化的（每行整理后内容的哈希和上次比），没有变化一个请求都不发；删掉的（取消收藏、删提醒）也推；
//   - 每 24 小时整体重推一次，最后一批让美国清掉这一轮没收到的，两边不会慢慢走样；
//   - 报错日志只增不改，记住推到第几条，接着往后推；
//   - 美国确认收下才记进度（状态文件），中途断了下次重推，重推不会出错（有就覆盖）。
// 格式见 格式.mjs；签名、5 分钟时效和公开比赛同步共用（同步秘钥 SYNC_SECRET 两条同步共用一把）。
//   node backend/沟通/用户数据同步/北京端.mjs [--full] [--dry-run]
//     要 USER_SYNC_ENDPOINT（美国的 https://…/sync/user）、SYNC_SECRET（或 SYNC_SECRET_FILE）、DB_DIR；状态文件 USER_SYNC_STATE_FILE
//
//   推送({ 用户库, 报错库, 地址, 秘钥, 状态文件, 全量, 试跑, fetch, now }) → { 写, 删, 报错, 全量, 试跑? }
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openUserDb } from '../../北京/副数据库/index.mjs';
import { 打开报错库 } from '../../北京/服务/收集报错/报错库.mjs';
import { 同步的表, 整理行, 时间头, 签名, 签名头 } from './格式.mjs';

const 整体重推间隔 = 24 * 60 * 60 * 1000;
const 每批最大字节 = 512 * 1024;
const 每批最多条数 = 200;
const 报错每次最多 = 2000;
const 哈希 = 内容 => crypto.createHash('sha256').update(JSON.stringify(内容)).digest('hex').slice(0, 16);

// 北京库里还没有这张表（比如校赛表：先部署美国、后部署北京）当成没有行，别的表照常同步
function 读表(用户库, 表) {
  try { return 用户库.find(表, {}); } catch (错误) {
    if (String(错误?.message || '').includes('没有这张表')) return [];
    throw 错误;
  }
}

// 北京现在的全部行（报错日志除外，它按编号接着推），整理好
export function 现在内容(用户库, 报错库) {
  const 行们 = [];
  for (const { 表, 主键 } of 同步的表) {
    if (表 === 'client_issues') continue;
    const 全部 = 表 === 'client_stats' ? 报错库.全部统计() : 读表(用户库, 表);
    for (const 行 of 全部) 行们.push({ 表, 编号: String(行[主键]), data: 整理行(表, 行) });
  }
  return 行们;
}

function 读状态(文件) {
  try { return JSON.parse(fs.readFileSync(文件, 'utf8')); } catch { return {}; }
}
function 存状态(文件, 状态) {
  fs.mkdirSync(path.dirname(文件), { recursive: true });
  fs.writeFileSync(文件, JSON.stringify(状态, null, 1), 'utf8');
}

// 按大小分批；删的放最后一批
function 分批(写们, 删们) {
  const 批们 = [];
  let 当前 = { 写们: [] }; let 大小 = 0;
  for (const 条 of 写们) {
    const 字节 = Buffer.byteLength(JSON.stringify(条));
    if (当前.写们.length && (大小 + 字节 > 每批最大字节 || 当前.写们.length >= 每批最多条数)) { 批们.push(当前); 当前 = { 写们: [] }; 大小 = 0; }
    当前.写们.push(条); 大小 += 字节;
  }
  if (当前.写们.length || 删们.length) 批们.push(当前);
  if (批们.length) 批们.at(-1).删们 = 删们;
  return 批们;
}

export async function 推送({ 用户库, 报错库, 地址, 秘钥, 状态文件, 全量 = false, 试跑 = false, fetch = globalThis.fetch, now = new Date() }) {
  const 状态 = 读状态(状态文件);
  const 整体 = 全量 || !状态.上次全量 || now.getTime() - Date.parse(状态.上次全量) > 整体重推间隔;
  const 上次 = 整体 ? {} : (状态.哈希 || {});
  const 现在哈希 = {};
  const 写们 = [];
  for (const 行 of 现在内容(用户库, 报错库)) {
    const 键 = `${行.表}:${行.编号}`;
    现在哈希[键] = 哈希(行.data);
    if (上次[键] !== 现在哈希[键]) 写们.push(行);
  }
  const 删们 = Object.keys(上次).filter(键 => !(键 in 现在哈希)).map(键 => { const i = 键.indexOf(':'); return { 表: 键.slice(0, i), 编号: 键.slice(i + 1) }; });
  // 报错日志：整体重推时从头推，平时从上次推到的编号往后
  const 报错们 = [];
  for (let 批 = 报错库.之后(整体 ? 0 : Number(状态.报错到 || 0), 报错每次最多); 批.length; 批 = 报错库.之后(批.at(-1).id, 报错每次最多)) 报错们.push(...批);
  const 结果 = { 写: 写们.length, 删: 删们.length, 报错: 报错们.length, 全量: 整体 };
  if (试跑) return { ...结果, 试跑: true };

  const 批们 = 分批([...写们, ...报错们.map(行 => ({ 表: 'client_issues', 编号: String(行.id), data: 整理行('client_issues', 行) }))], 删们);
  if (整体) {
    const 轮次 = `${now.toISOString()}-${crypto.randomBytes(4).toString('hex')}`;
    if (!批们.length) 批们.push({ 写们: [] });
    for (const 批 of 批们) 批.轮次 = 轮次;
    批们.at(-1).收尾 = true;
  }
  for (const 批次 of 批们) {
    const 正文 = JSON.stringify(批次);
    const 时间 = now.getTime();
    const 回应 = await fetch(地址, {
      method: 'POST', body: 正文,
      headers: { 'Content-Type': 'application/json', [时间头]: String(时间), [签名头]: 签名(秘钥, 时间, 正文) },
      signal: AbortSignal.timeout(60_000),
    });
    const 回 = await 回应.json().catch(() => null);
    if (!回应.ok || !回?.ok) throw new Error(`美国同步失败（HTTP ${回应.status}）：${回?.message || ''}`.trim());
  }
  const 报错到 = 报错们.length ? 报错们.at(-1).id : (整体 ? 0 : Number(状态.报错到 || 0));
  存状态(状态文件, { 哈希: 现在哈希, 上次全量: 整体 ? now.toISOString() : 状态.上次全量, 报错到 });
  return 结果;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const 秘钥 = process.env.SYNC_SECRET || (process.env.SYNC_SECRET_FILE ? fs.readFileSync(process.env.SYNC_SECRET_FILE, 'utf8').trim() : '');
  const 地址 = process.env.USER_SYNC_ENDPOINT || '';
  if (!地址 || !秘钥) { console.error('缺 USER_SYNC_ENDPOINT 或 SYNC_SECRET'); process.exit(1); }
  const 用户库 = openUserDb({ readOnly: true });
  const 报错库 = 打开报错库();
  try {
    const 结果 = await 推送({
      用户库, 报错库, 地址, 秘钥,
      状态文件: process.env.USER_SYNC_STATE_FILE || path.join(process.env.DB_DIR || '.', '用户数据同步状态.json'),
      全量: process.argv.includes('--full'), 试跑: process.argv.includes('--dry-run'),
    });
    console.log(`${new Date().toISOString()} 用户数据同步：${JSON.stringify(结果)}`);
  } catch (错误) {
    console.error(`${new Date().toISOString()} 用户数据同步失败：${错误?.message || 错误}`);
    process.exitCode = 1;
  } finally {
    用户库.close();
    报错库.关闭();
  }
}
