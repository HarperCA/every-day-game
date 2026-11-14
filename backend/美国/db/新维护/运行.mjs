// 新维护的运行入口（2026-11-08）：按调度挑到期的比赛（或命令行指定的），逐个 维护一个。
// 每天 10:00 的定时器跑一批（competition-radar-maintain-new）；后台多选的比赛排进维护队列，每 2 分钟的定时器用 --队列 处理（competition-radar-ai-queue，2026-11-12）。
//
//   node backend/美国/db/新维护/运行.mjs [--比赛 编号,编号] [--上限 20] [--并发 4] [--试跑] [--写脚本用kimi] [--报告 文件]
//   node backend/美国/db/新维护/运行.mjs --队列 [--并发 4] [--试跑] [--报告 文件]
//   node backend/美国/db/新维护/运行.mjs --找新一届 [--比赛 编号,编号] [--上限 30] [--并发 4] [--试跑] [--报告 文件]
//     --找新一届        已归档的比赛主动找新一届（2026-11-12 用户定，见 找新一届/）：没指定比赛就按 找新一届/挑比赛.mjs 挑
//                       （最新一届已归档、预计报名时间已过或 60 天内、7 天内没找过；预计时间近的先），逐个 找新一届；和每日新维护共用维护锁，拿不到就等。
//                       定时器 competition-radar-new-edition 每天 14:00 跑（见 ../../定时/）。
//     --队列            只处理后台多选排进维护队列的比赛（2026-11-12 用户定：旧 AI 审查删掉，手动勾选的改由新维护处理，数量不限）。
//                       队列空的马上退出（不拿锁、不打印）；每晚流程在跑、维护锁被占（每日那次或上一轮队列还在跑）就跳过这一轮，下次再看；
//                       拿到锁就一直处理到队列空（运行中新排进来的也接着做），不设上限。见 跑队列、运行队列。
//                       报告只在真跑了比赛时写。试跑只读打开、按队列名单跑一遍，不改队列。
//     --试跑            照常判断，不写比赛库（只读打开），入库按试跑
//     --写脚本用kimi    写爬虫脚本的 AI 临时换成 Kimi（本地没有 Codex 时用，2026-11-08 用户定；线上用 Codex）
//   环境变量：DB_DIR（比赛库）、AI_KEYS_DIR、AI_USAGE_DB（AI 总管）、PLAYWRIGHT_BROWSERS_PATH（浏览器程序放哪）
//     MAINTAIN_LOG_DIR（维护锁所在目录，没设就 db/数据/维护日志/）、PIPELINE_LOG_DIR（每晚流程的锁 .运行中.lock 所在目录）
//     BEIJING_FETCH_ENDPOINT + SYNC_SECRET（或 SYNC_SECRET_FILE）：都有时读网页、取源码网络问题读不到改请北京代读（2026-11-09，见 接北京兜底）
//
//   跑一批({ db, 比赛们, 上限, 并发, now, 维护, 选项, 算域名比赛数 }) → [维护一个的结果]
//     判断官网要的“同一域名下有几个比赛”（域名比赛数）一批只算一次，放进选项传给每个维护一个；选项里给了就用给的，名单空的不算。
//     同时跑 并发 个（默认 4，2026-11-08 用户要并行；AI 总管按车道限每家同时 4 个调用，同一网站读网页有统一限速）；结果按名单顺序交回。
//     一个出错记下原因接着下一个；AI 额度用完、余额不足、搜索超限、密钥错误就停：还没开始的不再开始，已经在跑的跑完。
//     （维护一个自己兜底：一般的异常按失败收尾交回，只有这几类收尾后往外抛）
//     每个比赛打印一行“编号：成功/失败，摘要（原因）”（摘要是后台显示的文字）。
//   跑队列({ db, 并发, now, 维护, 选项, 打印, 算域名比赛数, 该停 }) → { 结果们, 停因 }（2026-11-12）
//     额度暂停还没到点（维护队列.生效暂停）就不跑；先把上次异常退出留下的“正在”收回排队，再从维护队列逐个领（同时 并发 个），
//     每个做完在队列里标完成（成功看维护一个交回的 成功，摘要、结果、原因照记；一般的异常记失败“出错”）。
//     额度类错误（同 跑一批）：这个比赛放回排队最前，不再领新的，在跑的跑完，写 2 小时暂停，剩下的留在队列；
//     该停()（每晚流程开始了）也不再领新的。没停批、有做完的就清掉暂停。域名比赛数一轮只算一次。结果按做完的先后交回。
//   运行队列({ 锁目录, 流程锁, 有活, 跑, 打印 }) → { 跑了, 原因, ...跑() 交回的 }（2026-11-12）
//     定时器每 2 分钟调一次：有活() 为假（队列空）直接退出；每晚流程在跑、维护锁拿不到就打印一句跳过；拿到锁才 跑()，跑完放锁。
//   跑找新一届({ db, 比赛们, 上限, 并发, now, 找, 选项, 打印 }) → [找新一届的结果]（2026-11-12）
//     没给比赛就按 挑要找的 挑（最多 上限 个，默认 30）；挑不到什么都不做。逐个跑法、出错和停批同 跑一批（额度类错误停批）。
//   接北京兜底({ 读网页, 取源码 }, { 带北京兜底, 代读, env, 读文件 }) → { 读网页, 取源码 }
//     环境里有 BEIJING_FETCH_ENDPOINT 和同步秘钥（SYNC_SECRET，或 SYNC_SECRET_FILE 文件里的）就用 带北京兜底 包上，代读绑好地址和秘钥；
//     缺一个就原样交回。浏览器不经北京（北京没装浏览器）。经北京读到的结果带 经北京: true。
//   汇总(结果们) → { 共, 成功, 失败, 出错, 按结果: { 结果: 个数 }, 按摘要: { 摘要: 个数 } }
//     成功/失败看维护一个交回的 成功（2026-11-08），抛错的算出错（摘要算“出错”）
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as 等待 } from 'node:timers/promises';
import { 挑要查的 } from './调度/index.mjs';
import { 维护一个, 默认部件 } from './维护一个.mjs';
import { 找新一届 } from './找新一届/index.mjs';
import { 挑要找的 } from './找新一届/挑比赛.mjs';
import { 维护队列 } from '../index.mjs';
import { 拿锁, 流程在跑 } from '../../../共用/工具/运行锁.mjs';   // 维护锁：每日那次、队列模式共用一把（2026-11-11 线上改）

// 停批的 AI 错误种类（ai/common/errors.mjs 的 ERROR_KINDS；审查 11-08 加搜索超限、密钥错误）；余额不足（402）是“请求有误”，按文字认
const 要停的 = new Set(['额度用完', '搜索超限', '密钥错误']);
const 该停批 = error => 要停的.has(error?.kind) || /余额|insufficient balance|402/i.test(String(error?.message));
const 错误文字 = error => String(error?.message || error).slice(0, 200);
const 一行 = (id, 回) => `${id}：${回.成功 === false ? '失败' : '成功'}，${回.摘要 || 回.结果}${回.原因 ? `（${回.原因}）` : ''}`;

// 同时开 并发 个工人，每个工人反复 取下一个() → 做(项)，取不到就收工
async function 并发跑(并发, 取下一个, 做) {
  const 工人 = async () => { for (let 项 = 取下一个(); 项 != null; 项 = 取下一个()) await 做(项); };
  await Promise.all(Array.from({ length: Math.max(1, 并发) }, 工人));
}

export async function 跑一批({ db, 比赛们 = [], 上限 = 20, 并发 = 4, now = () => new Date(), 维护 = 维护一个, 选项: 给的选项 = {}, 打印 = () => {}, 算域名比赛数 = 默认部件.算域名比赛数 } = {}) {
  const 名单 = 比赛们.length ? 比赛们 : 挑要查的(db, { now: now(), 上限 }).map(x => x.比赛);
  const 选项 = 名单.length && 给的选项.域名比赛数 == null ? { ...给的选项, 域名比赛数: await 算域名比赛数(db) } : 给的选项;
  const 结果们 = new Array(名单.length);
  let 下一个 = 0;
  let 停了 = false;
  await 并发跑(Math.min(并发, 名单.length), () => (!停了 && 下一个 < 名单.length ? 下一个++ : null), async i => {
    const id = 名单[i];
    try {
      const 回 = await 维护(id, { db, now, ...选项 });
      结果们[i] = 回;
      打印(一行(id, 回));
    } catch (error) {
      结果们[i] = { 比赛: id, 结果: '出错', 原因: 错误文字(error) };
      打印(`${id}：出错 ${错误文字(error)}`);
      if (该停批(error)) 停了 = true;
    }
  });
  return 结果们.filter(Boolean);
}

export async function 跑找新一届({ db, 比赛们 = [], 上限 = 30, 并发 = 4, now = () => new Date(), 找 = 找新一届, 选项 = {}, 打印 = () => {} } = {}) {
  const 名单 = 比赛们.length ? 比赛们 : 挑要找的(db, { now: now(), 上限 }).map(x => x.比赛);
  if (!名单.length) return [];
  // 找新一届用不到域名比赛数，不让 跑一批 去算
  return 跑一批({ db, 比赛们: 名单, 并发, now, 维护: 找, 选项, 打印, 算域名比赛数: () => null });
}

export async function 跑队列({ db, 并发 = 4, now = () => new Date(), 维护 = 维护一个, 选项: 给的选项 = {}, 打印 = () => {}, 算域名比赛数 = 默认部件.算域名比赛数, 该停 = () => false } = {}) {
  const 结果们 = [];
  const 暂停 = 维护队列.生效暂停(db, now());
  if (暂停) return { 结果们, 停因: `AI 额度不足，暂停到 ${暂停.pausedUntil}（${暂停.reason || ''}）` };
  const 收回 = 维护队列.收回(db, { at: now().toISOString() });
  if (收回) 打印(`上次没做完的 ${收回} 个放回排队`);
  if (!维护队列.读(db).排队.length) return { 结果们, 停因: '' };
  const 选项 = 给的选项.域名比赛数 == null ? { ...给的选项, 域名比赛数: await 算域名比赛数(db) } : 给的选项;
  let 停因 = '';
  let 额度原因 = '';
  let 有做完的 = false;
  const 取下一个 = () => {
    if (停因) return null;
    if (该停()) { 停因 = '每晚流程开始了，不再领新的，剩下的留在队列'; return null; }
    return 维护队列.领下一个(db, { at: now().toISOString() });
  };
  await 并发跑(并发, 取下一个, async id => {
    try {
      const 回 = await 维护(id, { db, now, ...选项 });
      有做完的 = true;
      结果们.push(回);
      维护队列.完成(db, id, { at: now().toISOString(), 成功: 回.成功 !== false, 摘要: 回.摘要 || 回.结果, 结果: 回.结果, 原因: 回.原因 });
      打印(一行(id, 回));
    } catch (error) {
      结果们.push({ 比赛: id, 结果: '出错', 原因: 错误文字(error) });
      打印(`${id}：出错 ${错误文字(error)}`);
      if (该停批(error)) {
        维护队列.放回(db, id, { at: now().toISOString() });
        额度原因 ||= 错误文字(error);
        停因 = `AI 额度不足（${额度原因}），这一批停下，剩下的留在队列，暂停 2 小时`;
      } else {
        有做完的 = true;
        维护队列.完成(db, id, { at: now().toISOString(), 成功: false, 摘要: '出错', 结果: '出错', 原因: 错误文字(error) });
      }
    }
  });
  if (额度原因) 维护队列.暂停(db, 额度原因, { now: now() });
  else if (有做完的) 维护队列.清暂停(db, { now: now() });
  return { 结果们, 停因 };
}

export async function 运行队列({ 锁目录, 流程锁, 有活, 跑, 打印 = console.log }) {
  if (!有活()) return { 跑了: false, 原因: '队列空' };   // 每 2 分钟一次，空的不打印也不拿锁
  if (流程在跑(流程锁)) { 打印('每晚流程还在跑，这一轮队列维护跳过'); return { 跑了: false, 原因: '流程在跑' }; }
  const 放锁 = 拿锁(锁目录);
  if (!放锁) { 打印('别的维护还在跑（每日新维护或上一轮队列），这一轮跳过，下次再看'); return { 跑了: false, 原因: '锁被占' }; }
  try {
    return { 跑了: true, ...(await 跑()) };
  } finally {
    放锁();
  }
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

// 打开比赛库、AI 总管、浏览器，交给 做(db, 选项)，做完都关掉
async function 带部件(给, 试跑, 做) {
  const { openDb, 屏蔽网站 } = await import('../index.mjs');
  const { createAi, PURPOSES, DEFAULT_CONFIG } = await import('../../ai/index.mjs');
  const web = await import('../../web/index.mjs');
  const { 读网页, 取源码 } = 接北京兜底({ 读网页: web.读网页, 取源码: web.取源码 }, { 带北京兜底: web.带北京兜底, 代读: web.代读 });
  if (读网页 !== web.读网页) console.log('网络问题读不到的网页改请北京代读（BEIJING_FETCH_ENDPOINT）');
  const 配置 = 给.开关.has('写脚本用kimi')
    ? { ...DEFAULT_CONFIG, purposes: { ...PURPOSES, crawl_script: { ...PURPOSES.crawl_script, provider: 'kimi', model: 'kimi-for-coding', note: '本地试跑：写爬虫脚本临时换成 Kimi' } } }
    : undefined;
  const ai = createAi(配置 ? { config: 配置 } : {});
  const db = openDb({ readOnly: 试跑 });
  let 浏览器;
  try {
    浏览器 = web.建浏览器();
    return await 做(db, { ai, 工具: { 读网页, 取源码, 浏览器 }, 屏蔽: 屏蔽网站.当前屏蔽(db), 试跑 });
  } finally {
    try { await 浏览器?.关(); } finally { db.close(); }
  }
}

async function 写报告(文件, 结果们) {
  const fs = await import('node:fs');
  fs.mkdirSync(path.dirname(文件), { recursive: true });
  fs.writeFileSync(文件, JSON.stringify(结果们, null, 1));
}

// 交回 null 表示这一轮没跑（队列模式空跑、跳过），不打印汇总
async function 运行(argv) {
  const 给 = 参数(argv);
  const 试跑 = 给.开关.has('试跑');
  const 并发 = Number(给.并发 || 4);
  const 这里 = path.dirname(fileURLToPath(import.meta.url));
  // 锁目录：MAINTAIN_LOG_DIR，没设就 db/数据/维护日志/；每晚流程的锁在 PIPELINE_LOG_DIR/.运行中.lock
  const 锁目录 = process.env.MAINTAIN_LOG_DIR || path.join(这里, '..', '数据', '维护日志');
  const 流程锁 = path.join(process.env.PIPELINE_LOG_DIR || path.join(这里, '..', '..', 'pipeline', '日志'), '.运行中.lock');

  if (给.开关.has('队列')) {
    const { openDb } = await import('../index.mjs');
    const 读队列 = () => { const db = openDb({ readOnly: true }); try { return 维护队列.读(db); } finally { db.close(); } };
    if (试跑) {
      const 名单 = 读队列().排队;
      if (!名单.length) return null;
      return 带部件(给, true, (db, 选项) => 跑一批({ db, 比赛们: 名单, 并发, 打印: console.log, 选项 }));
    }
    const 回 = await 运行队列({
      锁目录, 流程锁, 打印: console.log,
      有活: () => { const q = 读队列(); return q.排队.length > 0 || q.正在.length > 0; },
      跑: () => 带部件(给, false, async (db, 选项) => {
        const { 结果们, 停因 } = await 跑队列({ db, 并发, 打印: console.log, 选项, 该停: () => 流程在跑(流程锁) });
        if (停因) console.log(停因);
        if (给.报告 && 结果们.length) await 写报告(给.报告, 结果们);
        return { 结果们 };
      }),
    });
    return 回.跑了 && 回.结果们.length ? 回.结果们 : null;
  }

  let 放锁;
  try {
    if (!试跑) {
      if (流程在跑(流程锁) || !(放锁 = 拿锁(锁目录))) {
        console.log('等待正在运行的维护或每晚流程结束');
        do { await 等待(5000); }
        while (流程在跑(流程锁) || !(放锁 = 拿锁(锁目录)));
      }
    }
    if (给.开关.has('找新一届')) {
      return await 带部件(给, 试跑, async (db, 选项) => {
        const 结果们 = await 跑找新一届({ db, 比赛们: 给.比赛 ? 给.比赛.split(',') : [], 上限: Number(给.上限 || 30), 并发, 打印: console.log,
          选项: { ai: 选项.ai, 工具: { 读网页: 选项.工具.读网页 }, 屏蔽: 选项.屏蔽, 试跑: 选项.试跑 } });
        if (给.报告) await 写报告(给.报告, 结果们);
        return 结果们;
      });
    }
    return await 带部件(给, 试跑, async (db, 选项) => {
      const 结果们 = await 跑一批({ db, 比赛们: 给.比赛 ? 给.比赛.split(',') : [], 上限: Number(给.上限 || 20), 并发, 打印: console.log, 选项 });
      if (给.报告) await 写报告(给.报告, 结果们);
      return 结果们;
    });
  } finally {
    放锁?.();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  运行(process.argv.slice(2)).then(结果们 => {
    if (结果们) {
      const 总 = 汇总(结果们);
      console.log(`跑完 ${总.共} 个：成功 ${总.成功}，失败 ${总.失败}，出错 ${总.出错}`);
      for (const [摘要, 个] of Object.entries(总.按摘要)) console.log(`  ${摘要}：${个}`);
    }
    process.exit(0);
  }, 错误 => { console.error(错误?.message || 错误); process.exit(1); });
}
