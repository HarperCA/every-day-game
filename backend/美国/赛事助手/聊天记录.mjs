// 聊天记录：给后台看的接口（2026-11-12 用户定）。后台只调这里，不自己读 assistant_log 表。
// 按天归档（北京时间，新的日子在前），每天按人分组；交回打码后的账号、用户输入的内容（带时间）和助手这一轮给用户的回答
// （2026-11-12 同日改：要看 AI 的回答），不带完整 openid，也不带模型原始输出、工具调用等别的字段。只读。
//
//   打开聊天记录(file) → 只读的记录库；库文件不存在（助手还没人用过）时是 null
//   聊天日期们(记录库, { 页 = 1, 每页 = 30 }) → { 日期们: [{ 日期, 人数, 条数 }], 总天数, 页, 每页 }
//   某天聊天(记录库, 'YYYY-MM-DD', { 账号备注 }) → [{ 账号, 条数, 输入们: [{ 时间: 'HH:MM', 内容, 回答, 状态 }] }]   人按这一天第一次说话的先后
//     账号：打码账号；这个 openid 有备注时写成 'oAbCdE…9876（管理员）'。账号备注 不给时每次现读 默认备注文件()，改了文件不用重启。
//     回答：这一轮给用户的回复文字（assistant_log 里的 reply）；出错没回的是 ''。
//     状态：正常回答是 ''；不正常时一句短的说明（见 回答状态），页面上写在回答那里
//   打码账号(openid) → 'oAbCdE…9876'
//   账号备注（2026-11-12 用户定）：后台认得出某个账号是谁（比如用户本人）。备注放在 JSON 文件 { "<完整 openid>": "备注" } 里，
//     不写进代码、不进 git。默认文件是问答记录库旁边的 账号备注.json（DB_DIR/账号备注.json），环境变量 ASSISTANT_ACCOUNT_NOTES_FILE 能改。
//   默认备注文件() → 路径
//   读账号备注(file = 默认备注文件()) → Map(openid → 备注)；文件不存在、读不了、不是 JSON 对象时是空的，不报错。
//     备注当文字：去掉控制字符（含换行）和 < > & " ' `，像 openid 的长串（13 个以上字母数字）打码，最多 20 个字，空的不要
// 记录库是 null 时两个都交回空的。日期、时间都是北京时间。一轮问答算一条（一句输入）。
import fs from 'node:fs';
import path from 'node:path';
import { 默认文件, 打开问答记录 } from './问答记录.mjs';

const 默认每页 = 30;
const 最多每页 = 100;
const 北京 = 8 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

export const 打开聊天记录 = (file = 默认文件()) => 打开问答记录(file, { 只读: true });

// 前 6 位 + … + 后 4 位（openid 一般 28 位）；短的只留头尾各 2 位，再短就全打掉
export function 打码账号(openid) {
  const s = String(openid ?? '');
  if (!s) return '未知';
  if (s.length > 12) return `${s.slice(0, 6)}…${s.slice(-4)}`;
  if (s.length > 5) return `${s.slice(0, 2)}…${s.slice(-2)}`;
  return '…';
}

export const 默认备注文件 = () => process.env.ASSISTANT_ACCOUNT_NOTES_FILE || path.join(path.dirname(默认文件()), '账号备注.json');
const 备注最长 = 20;

function 干净备注(值) {
  if (typeof 值 !== 'string') return '';
  const s = 值.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029<>&"'`]/g, '')
    .replace(/[A-Za-z0-9_-]{13,}/g, 打码账号)
    .trim();
  return [...s].slice(0, 备注最长).join('').trim();
}

export function 读账号备注(file = 默认备注文件()) {
  const 备注 = new Map();
  let 原始;
  try { 原始 = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return 备注; }
  if (!原始 || typeof 原始 !== 'object' || Array.isArray(原始)) return 备注;
  for (const [openid, 值] of Object.entries(原始)) {
    const 字 = 干净备注(值);
    if (openid && 字) 备注.set(openid, 字);
  }
  return 备注;
}

const 查备注 = (账号备注, openid) => (账号备注 instanceof Map ? 账号备注.get(openid) : 账号备注?.[openid]);
const 显示账号 = (账号备注, openid) => {
  const 备注 = openid ? 干净备注(查备注(账号备注, openid)) : '';
  return 备注 ? `${打码账号(openid)}（${备注}）` : 打码账号(openid);
};

const 正整数 = (值, 默认, 最大 = Infinity) => {
  const n = Math.floor(Number(值));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 最大) : 默认;
};

export function 聊天日期们(记录库, { 页, 每页 } = {}) {
  页 = 正整数(页, 1);
  每页 = 正整数(每页, 默认每页, 最多每页);
  if (!记录库) return { 日期们: [], 总天数: 0, 页, 每页 };
  return { 日期们: 记录库.按天汇总(每页, (页 - 1) * 每页), 总天数: 记录库.有记录的天数(), 页, 每页 };
}

// 北京时间这一天的 0 点（UTC 的 ISO 字符串）；不是真日期的拒绝
function 这天零点(日期) {
  const s = String(日期 ?? '');
  const 零点 = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T00:00:00+08:00`) : NaN;
  if (!Number.isFinite(零点) || new Date(零点 + 北京).toISOString().slice(0, 10) !== s) throw new Error(`日期要写成 YYYY-MM-DD：${s}`);
  return 零点;
}

// assistantCore 存的 status：answered / empty / clarify / chat 是正常回答；blocked 是内容安全拦下（输入或回答），
// 回给用户的是固定句子；出错时 status 是错误码，reply 是空的。status 是正常的、但回答里有网址或对不上的日期（replyViolations）时，
// 给用户的也换成了固定句子。
const 正常 = new Set(['answered', 'empty', 'clarify', 'chat']);
const 出错说明 = { assistant_timeout: '没有回答（超时）', assistant_ai_failed: '没有回答（AI 出错）', assistant_check_failed: '没有回答（内容安全检测出错）' };
function 回答状态(status, 回答, 违规数) {
  if (status === 'blocked') return '被内容安全拦下，回的是固定句子';
  if (出错说明[status]) return 出错说明[status];
  if (!回答) return '没有回答（出错）';
  if (正常.has(status) && 违规数 > 0) return '原回答有网址或对不上的日期，换成了固定句子';
  return '';
}

export function 某天聊天(记录库, 日期, { 账号备注 } = {}) {
  const 零点 = 这天零点(日期);
  if (!记录库) return [];
  账号备注 ??= 读账号备注();
  const 人们 = new Map();
  for (const r of 记录库.时间段内(new Date(零点).toISOString(), new Date(零点 + DAY_MS).toISOString())) {
    const 键 = r.openid ?? '';
    if (!人们.has(键)) 人们.set(键, { 账号: 显示账号(账号备注, 键), 条数: 0, 输入们: [] });
    const 人 = 人们.get(键);
    人.条数 += 1;
    const 回答 = typeof r.reply === 'string' ? r.reply : '';
    人.输入们.push({
      时间: new Date(Date.parse(r.created_at) + 北京).toISOString().slice(11, 16),
      内容: typeof r.message === 'string' ? r.message : '',
      回答, 状态: 回答状态(r.status, 回答, r.违规数),
    });
  }
  return [...人们.values()];
}
