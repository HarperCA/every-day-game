// 程序填：先用程序按固定的字段名填，填不上的再交给 DeepSeek（2026-11-01 用户定）。
// 通知页常写成“主办单位：××”“二、参赛对象：××”，或者标题单独一行、内容在下一行。只认行首的字段名，句子中间提到的不算；
// 同一字段取第一次出现的（正文是详情页在前、链接页在后）。每项的依据就是那一行（标题单独一行时是标题加下一行），回原文一定找得到。
// 报名日期只认写全了年份的（2026年10月15日、2026-10-15、2026.10.15、2026/10/15），没写年份的不猜，留给 DeepSeek。
// 这一步是新写的，旧代码全交给 AI 抽；各网站写法不一，程序能填上多少要用真实网页跑过才知道。
//
//   程序填(正文) → { fields: { 字段: { value, quote } }, 填了: [字段名] }
//   必要齐了(fields) → 主办方、参赛对象（或资格）、赛制、报名截止都有：不用再调 DeepSeek
export const 必要字段 = ['organizer', 'participants', 'format_and_rules', 'registration_end'];
export const 必要齐了 = (f = {}) => Boolean(f.organizer && (f.participants || f.eligibility) && f.format_and_rules && f.registration_end);

// 字段名：长的写在前面（“报名截止时间”先于“报名截止”）；字中间可以有空格（“主 办 方”）
const 文字字段 = {
  organizer: ['主办单位', '主办机构', '主办方', '主办'],
  participants: ['参赛对象', '参赛人员', '参赛范围', '参赛群体', '面向对象', '竞赛对象', '比赛对象'],
  eligibility: ['参赛资格', '参赛条件', '参赛要求', '报名条件', '报名资格'],
  format_and_rules: ['竞赛形式', '比赛形式', '竞赛方式', '比赛方式', '竞赛内容', '比赛内容', '竞赛规则', '比赛规则', '竞赛题目', '赛制'],
  team_size: ['组队要求', '组队方式', '组队规则', '团队组成', '团队人数', '每队人数', '参赛人数'],
  registration_method: ['报名方式', '报名方法', '报名流程', '报名途径', '报名渠道', '报名办法'],
  fees: ['报名费用', '参赛费用', '收费标准', '报名费', '参赛费', '费用'],
};
const 日期字段 = {
  截止: ['报名截止时间', '报名截止日期', '报名截至时间', '报名截至日期', '截止报名时间', '报名截止', '报名截至'],
  开始: ['报名开始时间', '报名开始日期', '报名开始'],
  一段: ['报名起止时间', '报名起止日期', '报名时间', '报名日期'],
};
const 拼 = 名们 => new RegExp(`^(?:${名们.map(名 => [...名].join('\\s*')).join('|')})\\s*(?:[:：]\\s*(.*))?$`);
const 规则们 = [...Object.entries(文字字段), ...Object.entries(日期字段)].map(([键, 名们]) => [键, 拼(名们)]);
const 序号 = /^[\s#*\-·•]*(?:[（(][一二三四五六七八九十\d]+[)）]|[一二三四五六七八九十]+[、.．]|\d+\s*[、.．)）])?\s*/;
const 最长 = 200;

const 去序号 = 行 => 行.replace(序号, '').trim();
const 认字段 = 行 => {
  for (const [键, 规则] of 规则们) {
    const m = 规则.exec(去序号(行));
    if (m) return { 键, 内容: (m[1] ?? '').trim() };
  }
  return null;
};

// 日期：只认带年份的；月、日对不上（13 月、2 月 30 日）的不算
const 全日期 = /(\d{4})\s*[年.\-/]\s*(\d{1,2})\s*[月.\-/]\s*(\d{1,2})\s*日?/g;
const 没年份日期 = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/;
function 成日期(y, m, d) {
  const t = new Date(Date.UTC(+y, +m - 1, +d));
  if (t.getUTCFullYear() !== +y || t.getUTCMonth() !== +m - 1 || t.getUTCDate() !== +d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
const 日期们 = 内容 => [...内容.matchAll(全日期)].map(m => ({ 值: 成日期(m[1], m[2], m[3]), 起: m.index, 止: m.index + m[0].length })).filter(d => d.值);

// 报名时间写成一段时：两头都有年份填两头；只有一个日期时看前后的字
function 一段(内容) {
  const ds = 日期们(内容);
  if (ds.length >= 2) return { 开始: ds[0].值, 截止: ds[1].值 };
  if (ds.length !== 1) return {};
  const 前 = 内容.slice(0, ds[0].起);
  const 后 = 内容.slice(ds[0].止);
  if (/^\s*(?:前|之前|止|截止)/.test(后) || /(?:截止|截至|至|到)\s*$/.test(前)) return { 截止: ds[0].值 };
  if (/^\s*(?:起|开始)/.test(后) || 没年份日期.test(后)) return { 开始: ds[0].值 };
  return {};
}

export function 程序填(正文 = '') {
  const 行们 = String(正文).split('\n');
  const fields = {};
  const 填 = (键, value, quote) => { if (!fields[键]) fields[键] = { value, quote }; };
  行们.forEach((行, i) => {
    const 认 = 认字段(行);
    if (!认) return;
    let { 内容 } = 认;
    let quote = 行.trim();
    // 标题单独一行：内容在下一行（下一行本身又是字段名的不算）
    if (!内容) {
      const 下 = 行们.slice(i + 1).find(x => x.trim());
      if (!下 || 认字段(下)) return;
      内容 = 下.trim();
      quote = `${行.trim()} ${内容}`;
    }
    if (认.键 in 文字字段) {
      if ([...内容].length < 2) return;
      填(认.键, [...内容].slice(0, 最长).join(''), quote);
      return;
    }
    const 日期 = 认.键 === '截止' ? { 截止: 日期们(内容)[0]?.值 } : 认.键 === '开始' ? { 开始: 日期们(内容)[0]?.值 } : 一段(内容);
    if (日期.开始) 填('registration_start', 日期.开始, quote);
    if (日期.截止) 填('registration_end', 日期.截止, quote);
  });
  return { fields, 填了: Object.keys(fields) };
}
