// 公开比赛同步（美国服务器这一端，2026-11-02）：把美国比赛库里已公开的比赛、届次推到北京主数据库。
// 规则照旧 scripts/server/sync-public-cache.mjs（每 5 分钟由定时器跑，见 美国/定时/competition-radar-public-sync.*）：
//   - 只推有变化的（按每条整理后内容的哈希比对），没有变化一个请求都不发；
//   - 每 24 小时整体重推一次，并让北京同版本也覆盖，防止两边慢慢走样（例如公开字段白名单改了）；
//   - 美国读到 0 条公开届次时拒绝推送，不拿空列表去把北京清空；
//   - 上次推过、现在不公开了的（删除、转回待人工审核）在北京下架；
//   - 海报先推（一张一个请求，推过的不再推，整体重推时再核一遍），推不上去的不挡比赛数据，下次再试；比赛数据按大小分批。
// 公开 = 届次状态是已发布或已归档、届次和比赛都没删。格式和秘钥规则见 格式.mjs。
//   node backend/沟通/公开比赛同步/美国端.mjs [--full] [--dry-run]
//     要 SYNC_ENDPOINT（北京的 https://…/sync/public）、SYNC_SECRET（或 SYNC_SECRET_FILE）、DB_DIR；海报目录 POSTER_DIR；状态文件 SYNC_STATE_FILE
//
//   推送({ db, 地址, 秘钥, 状态文件, 图片目录, 全量, 试跑, fetch, now }) → { 比赛, 届次, 下架, 海报, 海报失败, 全量, 试跑? }
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDb, 图片总库 } from '../../美国/db/index.mjs';
import { 整理届次, 整理比赛, 时间头, 签名, 签名头 } from './格式.mjs';

const 公开状态 = ['已发布', '已归档'];
const 整体重推间隔 = 24 * 60 * 60 * 1000;
const 每批最大字节 = 512 * 1024;
const 每批最多条数 = 200;

const 哈希 = 内容 => crypto.createHash('sha256').update(JSON.stringify(内容)).digest('hex').slice(0, 16);

// 读比赛库里公开的比赛、届次，按白名单整理好
export function 公开内容(db) {
  const 比赛们 = new Map(db.find('competition', {}).map(c => [c.id, c]));
  const 届次们 = db.find('edition', { status: { in: 公开状态 } }, { orderBy: 'id' }).filter(e => 比赛们.has(e.competition_id));
  const 来源按届次 = new Map();
  for (const s of db.find('source', { is_official: true, validity_status: 'valid' })) {
    if (!来源按届次.has(s.edition_id)) 来源按届次.set(s.edition_id, []);
    来源按届次.get(s.edition_id).push(s);
  }
  const 用到的比赛 = [...new Set(届次们.map(e => e.competition_id))].sort();
  return {
    比赛们: 用到的比赛.map(id => 整理比赛(比赛们.get(id))),
    届次们: 届次们.map(e => 整理届次(e, 来源按届次.get(e.id) || [])),
  };
}

// 和上次推送的记录比，决定这次推哪些、下架哪些、推哪些海报
export function 计划(内容, 状态 = {}, { 全量 = false, now = new Date() } = {}) {
  const 上次 = 状态.哈希 || {};
  const 整体 = 全量 || !状态.上次全量 || now.getTime() - Date.parse(状态.上次全量) > 整体重推间隔;
  const 现在哈希 = {};
  const 变了 = (键, 条) => { 现在哈希[键] = 哈希(条); return 整体 || 上次[键] !== 现在哈希[键]; };
  const 比赛们 = 内容.比赛们.filter(c => 变了(`比赛:${c.id}`, c));
  const 届次们 = 内容.届次们.filter(e => 变了(`届次:${e.id}`, e));
  const 没了 = Object.keys(上次).filter(键 => !(键 in 现在哈希));
  const 要的海报 = [...new Set(内容.届次们.map(e => e.data.poster?.file).filter(Boolean))];
  const 推过 = new Set(整体 ? [] : (状态.已推海报 || []));
  return {
    整体, 比赛们, 届次们, 哈希: 现在哈希,
    下架比赛: 没了.filter(键 => 键.startsWith('比赛:')).map(键 => 键.slice(3)),
    下架届次: 没了.filter(键 => 键.startsWith('届次:')).map(键 => 键.slice(3)),
    要推海报: 要的海报.filter(文件 => !推过.has(文件)),
    已推海报: 要的海报.filter(文件 => 推过.has(文件)),
  };
}

// 按大小分批：比赛在前、届次在后（届次挂的比赛先到）；下架放最后一批；整体重推时每批都让北京同版本也覆盖
export function 分批(方案) {
  const 条目 = [...方案.比赛们.map(c => ['比赛们', c]), ...方案.届次们.map(e => ['届次们', e])];
  const 批们 = [];
  let 当前 = { 比赛们: [], 届次们: [] }; let 大小 = 0; let 条数 = 0;
  for (const [种类, 条] of 条目) {
    const 字节 = Buffer.byteLength(JSON.stringify(条));
    if (条数 && (大小 + 字节 > 每批最大字节 || 条数 >= 每批最多条数)) { 批们.push(当前); 当前 = { 比赛们: [], 届次们: [] }; 大小 = 0; 条数 = 0; }
    当前[种类].push(条); 大小 += 字节; 条数 += 1;
  }
  if (条数 || 方案.下架比赛.length || 方案.下架届次.length) 批们.push(当前);
  if (批们.length) Object.assign(批们.at(-1), { 下架届次: 方案.下架届次, 下架比赛: 方案.下架比赛 });
  return 批们.map(批 => (方案.整体 ? { ...批, 同版本也覆盖: true } : 批));
}

function 读状态(文件) {
  try { return JSON.parse(fs.readFileSync(文件, 'utf8')); } catch { return {}; }
}
function 存状态(文件, 状态) {
  fs.mkdirSync(path.dirname(文件), { recursive: true });
  fs.writeFileSync(文件, JSON.stringify(状态, null, 1), 'utf8');
}

export async function 推送({ db, 地址, 秘钥, 状态文件, 图片目录, 全量 = false, 试跑 = false, fetch = globalThis.fetch, now = new Date() }) {
  const 内容 = 公开内容(db);
  if (!内容.届次们.length) throw new Error('美国比赛库里公开的届次是 0 条，疑似读库出错，本次不推（防止把北京清空）');
  const 状态 = 读状态(状态文件);
  const 方案 = 计划(内容, 状态, { 全量, now });
  const 结果 = { 比赛: 方案.比赛们.length, 届次: 方案.届次们.length, 下架: 方案.下架比赛.length + 方案.下架届次.length, 海报: 0, 海报失败: 0, 全量: 方案.整体 };
  if (试跑) return { ...结果, 要推海报: 方案.要推海报.length, 试跑: true };

  const 发 = async 批次 => {
    const 正文 = JSON.stringify(批次);
    const 时间 = now.getTime();
    const 回应 = await fetch(地址, {
      method: 'POST', body: 正文,
      headers: { 'Content-Type': 'application/json', [时间头]: String(时间), [签名头]: 签名(秘钥, 时间, 正文) },
      signal: AbortSignal.timeout(60_000),
    });
    const 回 = await 回应.json().catch(() => null);
    if (!回应.ok || !回?.ok) throw new Error(`北京同步失败（HTTP ${回应.status}）：${回?.message || ''}`.trim());
    return 回;
  };

  const 已推海报 = [...方案.已推海报];
  for (const 文件 of 方案.要推海报) {
    try {
      const { 内容: 图 } = 图片总库.读(文件, { 目录: 图片目录 });
      await 发({ 海报们: [{ 文件, 内容: 图.toString('base64') }] });
      已推海报.push(文件);
      结果.海报 += 1;
    } catch (错误) {
      // 一张失败不挡比赛数据，这张下次再试；卡片先显示文字封面
      结果.海报失败 += 1;
      console.error(`${now.toISOString()} 海报 ${文件} 推送失败：${String(错误?.message || 错误).slice(0, 160)}`);
    }
  }
  for (const 批次 of 分批(方案)) await 发(批次);
  存状态(状态文件, { 哈希: 方案.哈希, 上次全量: 方案.整体 ? now.toISOString() : 状态.上次全量, 已推海报 });
  return 结果;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const 秘钥 = process.env.SYNC_SECRET || (process.env.SYNC_SECRET_FILE ? fs.readFileSync(process.env.SYNC_SECRET_FILE, 'utf8').trim() : '');
  const 地址 = process.env.SYNC_ENDPOINT || '';
  if (!地址 || !秘钥) { console.error('缺 SYNC_ENDPOINT 或 SYNC_SECRET'); process.exit(1); }
  const db = openDb({ readOnly: true });
  try {
    const 结果 = await 推送({
      db, 地址, 秘钥,
      状态文件: process.env.SYNC_STATE_FILE || path.join(process.env.DB_DIR || '.', '公开比赛同步状态.json'),
      图片目录: process.env.POSTER_DIR || undefined,
      全量: process.argv.includes('--full'), 试跑: process.argv.includes('--dry-run'),
    });
    console.log(`${new Date().toISOString()} 公开比赛同步：${JSON.stringify(结果)}`);
  } catch (错误) {
    console.error(`${new Date().toISOString()} 公开比赛同步失败：${错误?.message || 错误}`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
