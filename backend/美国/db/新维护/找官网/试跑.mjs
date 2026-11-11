// 找官网 · 试跑命令：拿比赛库里的一个比赛，用真的 DeepSeek 联网和读网页跑一遍，把结果打出来。
// 默认只读比赛库、不写搜索记忆；加 --写记忆 才写回。AI 会话的来源是“手动测试”。密钥只在服务器上，本地没有密钥时一调 AI 就报错。
//
//   node backend/美国/db/新维护/找官网/试跑.mjs --比赛 <编号> [--年份 2026] [--届次 第十八届] [--写记忆]
//
// 目标（算目标）：命令行给了就用给的；否则看最新一届的年份（“2025—2026”取前一个）：
//   早于今年 → 找今年，届次不猜；今年或更晚 → 找下一年、下一届（届次按最新一届加一，认不出就不写）；认不出年份 → 找今年。
//   另带库里最新一届的年份、届次（已知年份、已知届次）：认官网时它们也算对上（2026-11-07 试水后用户同意）。
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const 北京今天 = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const 数字 = '零一二三四五六七八九';

function 中文转数(文字) {
  if (/^\d+$/.test(文字)) return Number(文字);
  const 对 = /^([一二三四五六七八九]?)(十?)([一二三四五六七八九]?)$/.exec(文字);
  if (!对 || !文字) return null;
  const [, 十位, 十, 个位] = 对;
  if (!十) return 十位 && !个位 ? 数字.indexOf(十位) : null;   // 没有“十”：只有一位数（正则把它放在第一组）
  return (十位 ? 数字.indexOf(十位) : 1) * 10 + (个位 ? 数字.indexOf(个位) : 0);
}

const 数转中文 = n => (n < 10 ? 数字[n] : `${Math.floor(n / 10) === 1 ? '' : 数字[Math.floor(n / 10)]}十${n % 10 ? 数字[n % 10] : ''}`);

// 下一届('第十七届') → '第十八届'；中文数字、阿拉伯数字都行，认不出交回 null
export function 下一届(届次) {
  const 对 = /^第(\d+|[一二三四五六七八九十]+)届$/.exec(String(届次 ?? '').trim());
  if (!对) return null;
  const n = 中文转数(对[1]);
  if (!n || n >= 99) return null;
  return /^\d+$/.test(对[1]) ? `第${n + 1}届` : `第${数转中文(n + 1)}届`;
}

export function 算目标(届次们, 今天 = 北京今天(), 给的 = {}) {
  const 今年 = Number(今天.slice(0, 4));
  const 最新 = [...(届次们 || [])].sort((a, b) => b.ordinal - a.ordinal)[0];
  const 年 = Number(/\d{4}/.exec(String(最新?.edition_year ?? ''))?.[0]) || null;
  const 已知 = { 已知年份: 年, 已知届次: 最新?.edition_ordinal || null };
  if (给的.年份) return { 年份: Number(给的.年份), 届次: 给的.届次 || null, ...已知 };
  if (!年 || 年 < 今年) return { 年份: 今年, 届次: 给的.届次 || null, ...已知 };
  return { 年份: 年 + 1, 届次: 给的.届次 || 下一届(最新.edition_ordinal), ...已知 };
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
  if (!给.比赛) throw new Error('要给 --比赛 <编号>');
  const { openDb, 比赛: 比赛表, 搜索记忆, 屏蔽网站 } = await import('../../index.mjs');
  const { session } = await import('../../../ai/index.mjs');
  const { 读网页 } = await import('../../../web/index.mjs');
  const { 找官网, 写回记忆 } = await import('./index.mjs');
  const 写 = 给.开关.has('写记忆');
  const db = openDb({ readOnly: !写 });
  try {
    const 行 = db.get('competition', 给.比赛);
    if (!行) throw new Error(`比赛库里没有 ${给.比赛}`);
    const 比赛 = 行.data;
    const 目标 = 算目标(比赛表.editionsOf(db, 比赛.id), 北京今天(), { 年份: 给.年份, 届次: 给.届次 });
    const 节 = 搜索记忆.读(db, 比赛.id)?.节 ?? 搜索记忆.解析(搜索记忆.初始(比赛));
    const ai = session({ source: '手动测试', module: '找官网' });
    const 回 = await 找官网(比赛, { ai, 读网页, 节, 目标, 屏蔽: 屏蔽网站.当前屏蔽(db) });
    const 写了 = 写 ? 写回记忆(db, 比赛.id, 回.记忆改动, { 操作人: '找官网试跑' }) : null;
    return { 比赛: `${比赛.id} ${比赛.name}`, 目标, ...回, 写了记忆: Boolean(写了) };
  } finally {
    db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  运行(process.argv.slice(2)).then(结果 => console.log(JSON.stringify(结果, null, 1)), 错误 => { console.error(错误?.message || 错误); process.exit(1); });
}
