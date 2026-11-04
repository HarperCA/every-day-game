// 补字段 · 程序核对：不信 Codex 的结论，每个值都要在它读过的官方网页原文里找得到（“没核到的不写”）。
//   核对一项({ 字段, 值, 网址, 原文 }, 读过) → { ok: true, 值 } 或 { ok: false, 原因 }
//   核对待公布({ 字段, 网址, 原文 }, 读过) → 同上
// 读过：Map(网址 → { 正文, 链接们 })。比较时去掉空白和标点（和 03 的 Codex 代理追踪一样）。
import { 专业分类, 字段表, 能待公布 } from './字段.mjs';

const 正文最少字 = 200;
const 压 = text => String(text || '').replace(/[\s\p{P}\p{S}]/gu, '');
const 待公布说法 = /待定|待公布|暂未公布|另行通知|另行公布|另行发布|以.{0,15}通知为准/;

// 原文和网页：网页要读过、读到正文，原文要在网页里
function 出处对不对(网址, 原文, 读过) {
  const 页 = 读过.get(网址);
  if (!页) return '网页没读过';
  if (页.正文.length < 正文最少字) return '网页没读到正文';
  if (!压(原文) || !压(页.正文).includes(压(原文))) return '原文不在网页里';
  return '';
}

// 原文里写到的日子（年月日；只写月日的，年份要在网页里出现过），交回 'YYYY-MM-DD' 的集合
function 原文里的日子(原文, 正文) {
  const 日子 = new Set();
  const 补零 = n => String(n).padStart(2, '0');
  for (const m of 原文.matchAll(/(\d{4})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*日?/g)) 日子.add(`${m[1]}-${补零(m[2])}-${补零(m[3])}`);
  for (const m of 原文.matchAll(/(?<!\d|年\s*)(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)) {
    for (const 年 of new Set([...正文.matchAll(/(20\d{2})\s*年/g)].map(x => x[1]))) 日子.add(`${年}-${补零(m[1])}-${补零(m[2])}`);
  }
  return 日子;
}

function 日期对不对(值, 原文, 正文) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(值 || ''));
  if (!m || Number.isNaN(Date.parse(值))) return '日期格式不对（要 2026-09-01 或带时区的时间）';
  if (!原文里的日子(原文, 正文).has(m[1])) return '原文里没有这一天';
  // 带了钟点的，原文里要写着这个钟点（17:00、17：00、17时）
  if (m[2] && !new RegExp(`(^|\\D)${Number(m[2])}\\s*[:：时]\\s*${m[3] === '00' ? '(00)?' : m[3]}`).test(原文)) return '原文里没有这个钟点';
  return '';
}

export function 核对一项({ 字段, 值, 网址, 原文 }, 读过) {
  const 定义 = 字段表[字段];
  if (!定义) return { ok: false, 原因: '不是能补的字段' };
  const 出处 = 出处对不对(网址, 原文, 读过);
  if (出处) return { ok: false, 原因: 出处 };
  const 页 = 读过.get(网址);
  if (定义.类型 === '日期') {
    const 错 = 日期对不对(值, 原文, 页.正文);
    return 错 ? { ok: false, 原因: 错 } : { ok: true, 值 };
  }
  if (定义.类型 === '专业') {
    const 留 = (Array.isArray(值) ? 值 : [值]).filter(x => 专业分类.includes(x));
    return 留.length ? { ok: true, 值: [...new Set(留)] } : { ok: false, 原因: '不是十三类专业里的' };
  }
  if (定义.类型 === '网址') {
    const 网 = String(值 || '').trim();
    const 出现过 = /^https?:\/\//i.test(网) && (网 === 网址 || 页.链接们.includes(网) || 页.正文.includes(网));
    return 出现过 ? { ok: true, 值: 网 } : { ok: false, 原因: '网址没在读过的网页里出现' };
  }
  const 文字 = String(值 || '').trim();
  if (!文字) return { ok: false, 原因: '值是空的' };
  return 压(原文).includes(压(文字)) ? { ok: true, 值: 文字 } : { ok: false, 原因: '值不在原文里' };
}

export function 核对待公布({ 字段, 网址, 原文 }, 读过) {
  if (!能待公布(字段)) return { ok: false, 原因: '只有时间能标待公布' };
  const 出处 = 出处对不对(网址, 原文, 读过);
  if (出处) return { ok: false, 原因: 出处 };
  return 待公布说法.test(原文) ? { ok: true } : { ok: false, 原因: '原文没说待公布或另行通知' };
}
