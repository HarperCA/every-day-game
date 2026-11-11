// 细分专业轮换：从旧的 scripts/server/search-plan.mjs 搬来（planMajorQueries、updateCooldown 等），规则不变，名字改成中文。
//
// 词库是 专业目录.json（教育部《普通高等学校本科专业目录（2026年）》，883 种专业，和旧的 majors-2026.json 相同）。
// 顺序（2026-10-10 用户定）：①门类在校生人数从少到多（交叉学科今年新设、没有统计，排最前）；
// ②同一门类里先今年新增的专业，再带“T”的特设专业，最后是基本专业；③再按专业代码。每个专业一次搜索。
// 搜过的 30 天内不再搜；连续两次零候选的词暂停 2、4、8……天（最长 32 天），到期自动恢复。
//
// 历史从本文件夹的记录表读（记录表.mjs，冷却规则也在那里），这里只按历史挑词，不读写记录表。
import fs from 'node:fs';

export const 默认额度 = 30; // 百度每天给自动任务 30 次（2026-10-10 用户定），全部给细分专业
export const 不重复天数 = 30;
export const 最长字节 = 72; // 百度接口限制：查询最长 72 字节，汉字算 2
export const 路线 = '细分专业';
const 天 = 86400000;
const 档名 = ['今年新增', '特设专业', '基本专业'];

let 目录缓存 = null;
export function 载入专业目录(file = new URL('./专业目录.json', import.meta.url)) {
  if (!目录缓存) 目录缓存 = JSON.parse(fs.readFileSync(file, 'utf8')).majors || [];
  return 目录缓存;
}

export function 字节数(text) {
  let n = 0;
  for (const ch of String(text)) n += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  return n;
}

// 超长时截短前面的主体，后缀保留
function 截短(主体, 后缀) {
  let text = String(主体).trim();
  while (text && 字节数(`${text} ${后缀}`) > 最长字节) text = text.slice(0, -1);
  return `${text} ${后缀}`.trim();
}

export const 专业搜索词 = (名称, 年份) => 截短(`${String(名称).trim()} 大学生 竞赛`, `${年份} 报名`);

const 档 = m => m.new2026 ? 0 : /T/.test(m.code) ? 1 : 2;
const 在校生 = m => (m.gateEnrollment === null || m.gateEnrollment === undefined ? -1 : m.gateEnrollment);

export function 排专业顺序(专业们) {
  return [...专业们].sort((a, b) => 在校生(a) - 在校生(b) || 档(a) - 档(b) || a.code.localeCompare(b.code));
}

const 暂停中 = (历史, 词, now) => {
  const 到 = Date.parse(历史[词]?.暂停到 || '');
  return Number.isFinite(到) && 到 > now.getTime();
};

// 按顺序挑出个数个：30 天内搜过的、冷却中的跳过
export function 挑专业(专业们, 个数, 历史, now, 年份) {
  const 界线 = now.getTime() - 不重复天数 * 天;
  const 挑中 = [];
  for (const m of 排专业顺序(专业们)) {
    if (挑中.length >= 个数) break;
    const 词 = 专业搜索词(m.name, 年份);
    const 上次 = Date.parse(历史[词]?.上次搜索 || '') || 0;
    if (上次 >= 界线 || 暂停中(历史, 词, now) || 挑中.some(x => x.词 === 词)) continue;
    挑中.push({ 路线, 词, 专业: m.name, 专业代码: m.code, 专业类: m.cls, 门类: m.gate,
      理由: `细分专业“${m.name}”（${m.gate}·${m.cls}，代码 ${m.code}，${档名[档(m)]}；门类在校生 ${m.gateEnrollment ?? '无统计'}）：${上次 ? `上次搜索 ${new Date(上次).toISOString().slice(0, 10)}` : '从未搜过'}` });
  }
  return 挑中;
}
