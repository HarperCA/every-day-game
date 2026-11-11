// 新维护的运行入口（2026-11-08）：按调度挑到期的比赛（或命令行指定的），逐个 维护一个。还没接定时器。
//
//   node backend/美国/db/新维护/运行.mjs [--比赛 编号,编号] [--上限 20] [--并发 4] [--试跑] [--写脚本用kimi] [--报告 文件]
//     --试跑            照常判断，不写比赛库（只读打开），入库按试跑
//     --写脚本用kimi    写爬虫脚本的 AI 临时换成 Kimi（本地没有 Codex 时用，2026-11-08 用户定；线上用 Codex）
//   环境变量：DB_DIR（比赛库）、AI_KEYS_DIR、AI_USAGE_DB（AI 总管）、PLAYWRIGHT_BROWSERS_PATH（浏览器程序放哪）
//     BEIJING_FETCH_ENDPOINT + SYNC_SECRET（或 SYNC_SECRET_FILE）：都有时读网页、取源码网络问题读不到改请北京代读（2026-11-09，见 接北京兜底）
//
//   跑一批({ db, 比赛们, 上限, 并发, now, 维护, 选项, 算域名比赛数 }) → [维护一个的结果]
//     判断官网要的“同一域名下有几个比赛”（域名比赛数）一批只算一次，放进选项传给每个维护一个；选项里给了就用给的，名单空的不算。
//     同时跑 并发 个（默认 4，2026-11-08 用户要并行；AI 总管按车道限每家同时 4 个调用，同一网站读网页有统一限速）；结果按名单顺序交回。
//     一个出错记下原因接着下一个；AI 额度用完、余额不足、搜索超限、密钥错误就停：还没开始的不再开始，已经在跑的跑完。
//     （维护一个自己兜底：一般的异常按失败收尾交回，只有这几类收尾后往外抛）
//     每个比赛打印一行“编号：成功/失败，摘要（原因）”（摘要是后台显示的文字）。
//   接北京兜底({ 读网页, 取源码 }, { 带北京兜底, 代读, env, 读文件 }) → { 读网页, 取源码 }
//     环境里有 BEIJING_FETCH_ENDPOINT 和同步秘钥（SYNC_SECRET，或 SYNC_SECRET_FILE 文件里的）就用 带北京兜底 包上，代读绑好地址和秘钥；
//     缺一个就原样交回。浏览器不经北京（北京没装浏览器）。经北京读到的结果带 经北京: true。
//   汇总(结果们) → { 共, 成功, 失败, 出错, 按结果: { 结果: 个数 }, 按摘要: { 摘要: 个数 } }
//     成功/失败看维护一个交回的 成功（2026-11-08），抛错的算出错（摘要算“出错”）
import path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as 等待 } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { 拿锁, 流程在跑 } from '../../../共用/工具/运行锁.mjs';
import { 挑要查的 } from './调度/index.mjs';
import { 维护一个, 默认部件 } from './维护一个.mjs';

// 停批的 AI 错误种类（ai/common/errors.mjs 的 ERROR_KINDS；审查 11-08 加搜索超限、密钥错误）；余额不足（402）是“请求有误”，按文字认
const 要停的 = new Set(['额度用完', '搜索超限', '密钥错误']);

export async function 跑一批({ db, 比赛们 = [], 上限 = 20, 并发 = 4, now = () => new Date(), 维护 = 维护一个, 选项: 给的选项 = {}, 打印 = () => {}, 算域名比赛数 = 默认部件.算域名比赛数 } = {}) {
  const 名单 = 比赛们.length ? 比赛们 : 挑要查的(db, { now: now(), 上限 }).map(x => x.比赛);
  const 选项 = 名单.length && 给的选项.域名比赛数 == null ? { ...给的选项, 域名比赛数: await 算域名比赛数(db) } : 给的选项;
  const 结果们 = new Array(名单.length);
  let 下一个 = 0;
  let 停了 = false;
  async function 工人() {
    while (!停了 && 下一个 < 名单.length) {
      const i = 下一个;
      下一个 += 1;
      const id = 名单[i];
      try {
        const 回 = await 维护(id, { db, now, ...选项 });
        结果们[i] = 回;
        打印(`${id}：${回.成功 === false ? '失败' : '成功'}，${回.摘要 || 回.结果}${回.原因 ? `（${回.原因}）` : ''}`);
      } catch (error) {
        结果们[i] = { 比赛: id, 结果: '出错', 原因: String(error?.message || error).slice(0, 200) };
        打印(`${id}：出错 ${String(error?.message || error).slice(0, 200)}`);
        if (要停的.has(error?.kind) || /余额|insufficient balance|402/i.test(String(error?.message))) 停了 = true;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(并发, 名单.length)) }, 工人));
  return 结果们.filter(Boolean);
}

export function 汇总(结果们 = []) {
  const 回 = { 共: 结果们.length, 成功: 0, 失败: 0, 出错: 0, 按结果: {}, 按摘要: {} };
  for (const x of 结果们) {
    if (x.结果 === '出错' && x.成功 === undefined) 回.出错 += 1;
    else if (x.成功) 回.成功 += 1;
    else 回.失败 += 1;
    回.按结果[x.结果] = (回.按结果[x.结果] || 0) + 1;
    const 摘要 = x.摘要 || (x.结果 === '出错' ? '出错' : x.结果);
    回.按摘要[摘要] = (回.按摘要[摘要] || 0) + 1;
  }
  return 回;
}

export function 接北京兜底({ 读网页, 取源码 }, { 带北京兜底, 代读, env = process.env, 读文件 = 文件 => readFileSync(文件, 'utf8') }) {
  const 地址 = env.BEIJING_FETCH_ENDPOINT;
  const 秘钥 = env.SYNC_SECRET || (env.SYNC_SECRET_FILE ? 读文件(env.SYNC_SECRET_FILE).trim() : '');
  if (!地址 || !秘钥) return { 读网页, 取源码 };
  return 带北京兜底({ 读网页, 取源码, 代读: (网址, 选项 = {}) => 代读(网址, { ...选项, endpoint: 地址, 秘钥 }) });
}

function 参数(argv) {
  const 结果 = { 开关: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const 名 = argv[i].slice(2);
    if (argv[i + 1] && !argv[i + 1].startsWith('--')) { 结果[名] = argv[i + 1]; i += 1; } else 结果.开关.add(名);
  }
  return 结果;
}

async function 运行(argv) {
  const 给 = 参数(argv);
  const 试跑 = 给.开关.has('试跑');
  if (试跑) return 运行一批(给, 试跑);

  const 当前目录 = path.dirname(fileURLToPath(import.meta.url));
  const 锁目录 = process.env.MAINTAIN_LOG_DIR || path.join(当前目录, '..', '数据', '维护日志');
  const 流程锁 = path.join(process.env.PIPELINE_LOG_DIR || path.join(当前目录, '..', '..', 'pipeline', '日志'), '.运行中.lock');
  let 放锁 = null;
  try {
    放锁 = 流程在跑(流程锁) ? null : 拿锁(锁目录);
    if (!放锁) console.log('等待每日流程或其他维护完成');
    while (!放锁) {
      await 等待(5000);
      if (!流程在跑(流程锁)) 放锁 = 拿锁(锁目录);
    }
    return await 运行一批(给, 试跑);
  } finally {
    放锁?.();
  }
}

async function 运行一批(给, 试跑) {
  const { openDb, 屏蔽网站 } = await import('../index.mjs');
  const { createAi, PURPOSES, DEFAULT_CONFIG } = await import('../../ai/index.mjs');
  const web = await import('../../web/index.mjs');
  const { 建浏览器 } = web;
  const { 读网页, 取源码 } = 接北京兜底({ 读网页: web.读网页, 取源码: web.取源码 }, { 带北京兜底: web.带北京兜底, 代读: web.代读 });
  if (读网页 !== web.读网页) console.log('网络问题读不到的网页改请北京代读（BEIJING_FETCH_ENDPOINT）');
  const 配置 = 给.开关.has('写脚本用kimi')
    ? { ...DEFAULT_CONFIG, purposes: { ...PURPOSES, crawl_script: { ...PURPOSES.crawl_script, provider: 'kimi', model: 'kimi-for-coding', note: '本地试跑：写爬虫脚本临时换成 Kimi' } } }
    : undefined;
  const ai = createAi(配置 ? { config: 配置 } : {});
  const db = openDb({ readOnly: 试跑 });
  const 浏览器 = 建浏览器();
  try {
    const 结果们 = await 跑一批({
      db, 比赛们: 给.比赛 ? 给.比赛.split(',') : [], 上限: Number(给.上限 || 20), 并发: Number(给.并发 || 4), 打印: console.log,
      选项: { ai, 工具: { 读网页, 取源码, 浏览器 }, 屏蔽: 屏蔽网站.当前屏蔽(db), 试跑 },
    });
    if (给.报告) writeFileSync(给.报告, JSON.stringify(结果们, null, 1));
    return 结果们;
  } finally {
    try { await 浏览器.关(); } finally { db.close(); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  运行(process.argv.slice(2)).then(结果们 => {
    const 总 = 汇总(结果们);
    console.log(`跑完 ${总.共} 个：成功 ${总.成功}，失败 ${总.失败}，出错 ${总.出错}`);
    for (const [摘要, 个] of Object.entries(总.按摘要)) console.log(`  ${摘要}：${个}`);
    process.exit(0);
  }, 错误 => { console.error(错误?.message || 错误); process.exit(1); });
}
