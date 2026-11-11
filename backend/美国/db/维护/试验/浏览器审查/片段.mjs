// 从网页全文里截出要紧的段落交给 Codex，文字一个字不改（程序之后还要逐字核对）。纯函数。
//   截取片段(正文, { 名称, 上限 }) → { 片段, 总字数, 显示字数 }
//   筛链接(链接们, { 名称, 上限 }) → 留附件、报名、通知类的链接，导航去掉
const 日期 = /\d{4}\s*[年./-]\s*\d{1,2}|\d{1,2}\s*月\s*\d{1,2}\s*日/;
const 时间词 = /报名|截止|提交|报送|收稿|时间|举办|决赛|日程|安排/;
const 跳过标记 = '……';

function 分段(正文) {
  const 段们 = [];
  for (const 行 of String(正文 || '').split(/\r?\n/)) {
    const 净 = 行.trim();
    if (!净) continue;
    if (净.length <= 200) { 段们.push(净); continue; }
    for (const 句 of 净.split(/(?<=[。；！？;!?])/)) if (句.trim()) 段们.push(句.trim());
  }
  return 段们;
}

function 打分(段, 名称) {
  let 分 = 0;
  if (日期.test(段)) 分 += 2 + (时间词.test(段) ? 3 : 0);
  if (/主办|承办|协办|指导单位|组委会/.test(段)) 分 += 4;
  if (/参赛对象|参赛资格|在校|本科|研究生|大学生/.test(段)) 分 += 2;
  if (/报名|截止|报送|提交作品|作品提交/.test(段)) 分 += 3;
  if (/费用|收费|报名费|奖金|奖励|一等奖/.test(段)) 分 += 1;
  if (/赛制|规则|赛程|竞赛内容/.test(段)) 分 += 1;
  if (/第.{1,3}届/.test(段)) 分 += 1;
  if (名称 && 段.includes(名称)) 分 += 3;
  return 分;
}

export function 截取片段(正文, { 名称 = '', 上限 = 2500 } = {}) {
  const 文字 = String(正文 || '').trim();
  const 总字数 = String(正文 || '').length;
  if (文字.length <= 上限) return { 片段: 文字, 总字数, 显示字数: 文字.length };

  const 见过 = new Set();
  const 段们 = 分段(文字).map((内容, 序) => ({ 内容, 序, 分: 打分(内容, 名称) + (序 < 2 ? 2 : 0) })).filter(段 => {
    if (见过.has(段.内容)) return false;
    见过.add(段.内容);
    return 段.分 > 0;
  });
  const 选中 = [];
  let 用了 = 0;
  for (const 段 of [...段们].sort((a, b) => b.分 - a.分 || a.序 - b.序)) {
    const 长 = 段.内容.length + 跳过标记.length + 2;   // 算上换行和跳过标记，保证不超
    if (用了 + 长 > 上限) continue;
    选中.push(段);
    用了 += 长;
  }
  选中.sort((a, b) => a.序 - b.序);
  const 行们 = [];
  选中.forEach((段, i) => {
    if (i > 0 && 段.序 !== 选中[i - 1].序 + 1) 行们.push(跳过标记);
    行们.push(段.内容);
  });
  const 片段 = 行们.join('\n') || 文字.slice(0, 上限);
  return { 片段, 总字数, 显示字数: 片段.length };
}

function 链接分(链接, 名称) {
  const 字 = `${链接.text || ''} ${链接.url || ''}`;
  let 分 = 0;
  if (/\.(pdf|docx?|xlsx?)(\?|$)|附件/i.test(字)) 分 += 3;
  if (/报名|提交|注册/.test(链接.text || '')) 分 += 3;
  if (/通知|公告|方案|章程|规程|竞赛|大赛|比赛/.test(链接.text || '')) 分 += 2;
  if (名称 && String(链接.text || '').includes(名称)) 分 += 3;
  return 分;
}

export function 筛链接(链接们, { 名称 = '', 上限 = 8 } = {}) {
  const 见过 = new Set();
  return (链接们 || [])
    .map((链接, 序) => ({ 链接, 序, 分: 链接分(链接, 名称) }))
    .filter(x => x.分 > 0 && x.链接.url && !见过.has(x.链接.url) && 见过.add(x.链接.url))
    .sort((a, b) => b.分 - a.分 || a.序 - b.序)
    .slice(0, 上限)
    .map(x => ({ url: x.链接.url, text: String(x.链接.text || '').slice(0, 40) }));
}
