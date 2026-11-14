import { createHash } from 'node:crypto';
import { 规范名称 } from './规范名称.mjs';

const 年份 = /(?<!\d)((?:19|20)\d{2}(?:\s*[-—–~～至]\s*(?:19|20)\d{2})?)(?:年(?:度)?|赛季)?(?!\d)/;
const 届次 = /第[零〇一二三四五六七八九十百千万两\d]+届/;
export function 拆名称(value) {
  const text = String(value || '').trim();
  const y = 年份.exec(text);
  const o = 届次.exec(text);
  const 名称 = text.replace(new RegExp(年份.source, 'g'), '').replace(new RegExp(届次.source, 'g'), '')
    .replace(/\(\s*\)|（\s*）|【\s*】|\[\s*\]/g, '').replace(/\s{2,}/g, ' ')
    .replace(/^[\s,，、:：|｜丨·•\-—–]+|[\s,，、:：|｜丨·•\-—–]+$/g, '').trim();
  return { 名称: 名称 || text, 年份: y ? y[1].replace(/\s*[-–~～至]\s*/g, '—') : null, 届次: o ? o[0] : null };
}

// 认届次时比的两样（2026-11-08 代码审查：字符串完全相等太严，“第10届”对不上“第十届”就重复建届）：
//   年份起点('2025—2026') → 2025   年份区间取前一个年份
//   届次数('第十届') → 10、届次数('第10届') → 10   中文、阿拉伯数字都换成数；认不出的交回 null
export const 年份起点 = y => { const m = /(?:19|20)\d{2}/.exec(String(y ?? '')); return m ? Number(m[0]) : null; };
const 中文数字 = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const 中文单位 = { 十: 10, 百: 100, 千: 1000 };
export function 届次数(value) {
  const m = /第\s*([零〇一二三四五六七八九十百千万两\d]+)\s*届/.exec(String(value ?? ''));
  if (!m) return null;
  if (/^\d+$/.test(m[1])) return Number(m[1]);
  let 总 = 0, 节 = 0, 当前 = 0;
  for (const ch of m[1]) {
    if (ch in 中文数字) 当前 = 中文数字[ch];
    else if (ch in 中文单位) { 节 += (当前 || 1) * 中文单位[ch]; 当前 = 0; }
    else if (ch === '万') { 总 += (节 + 当前) * 10000; 节 = 0; 当前 = 0; }
    else return null;   // 中文和阿拉伯数字混写的不认
  }
  return 总 + 节 + 当前 || null;
}

// 标题里的括号、冒号或分隔线可以明确区分总赛事和单独赛道。
const 标题赛道 = /(?:[（(【\[]\s*([^()（）【】\[\]]{1,60}(?:赛道|专项赛|专项|组别|组))\s*[）)】\]]|[：:｜|·—]\s*([^：:｜|·—]{1,60}(?:赛道|专项赛|专项|组别|组)))\s*$/u;
const 赛道键 = value => String(value || '').normalize('NFKC').replace(/[\s“”「」《》]/gu, '').replace(/(?:赛道|组别)$/, '');

export function 比赛身份(name, track) {
  const 届 = 拆名称(name);
  const 括号后缀 = /[（(【\[]([^()（）【】\[\]]+)[）)】\]]$/.exec(届.名称);
  const 后缀 = (track && 括号后缀 && 赛道键(括号后缀[1]) === 赛道键(track) ? 括号后缀 : null)
    || 标题赛道.exec(届.名称);
  const 赛道 = String(track || 后缀?.[1] || 后缀?.[2] || '').trim();
  const 名称 = (后缀 ? 届.名称.slice(0, 后缀.index) : 届.名称).trim();
  return { 名称, 名称键: 规范名称(名称), 赛道, 赛道键: 赛道键(赛道), 年: 年份起点(届.年份), 第几届: 届次数(届.届次) };
}

export function 比届次(a, b) {
  // 两边都有届数时，届数优先于年份。同一年可能举办不同届。
  if (a.第几届 != null && b.第几届 != null) return Math.sign(a.第几届 - b.第几届);
  if (a.年 != null && b.年 != null) return Math.sign(a.年 - b.年);
  return null;
}

export function 库中届次(data, name) {
  const 身份 = 比赛身份(data.edition_name || name, data.track_name || 比赛身份(name).赛道);
  return {
    ...身份,
    年: 年份起点(data.edition_year) ?? 身份.年,
    第几届: 届次数(data.edition_ordinal) ?? 身份.第几届,
  };
}

export function 搜索候选键(url, name, track) {
  const { 赛道键, 名称键 } = 比赛身份(name, track);
  if (!赛道键 && url.length <= 300) return url;
  const hash = createHash('sha256').update(JSON.stringify([url, 赛道键 ? 名称键 : '', 赛道键])).digest('hex');
  return 'candidate-' + hash;
}
