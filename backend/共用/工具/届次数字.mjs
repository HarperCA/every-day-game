const 中文数 = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const 中文位 = { 十: 10, 百: 100, 千: 1000 };
function 中文转数(文字) {
  if (/^\d+$/.test(文字)) return Number(文字);
  let 合计 = 0, 当前 = 0;
  for (const 字 of 文字) {
    if (字 in 中文数) 当前 = 中文数[字];
    else if (字 in 中文位) { 合计 += (当前 || 1) * 中文位[字]; 当前 = 0; }
    else return null;
  }
  return 合计 + 当前 || null;
}

// 认届次('第九届') → 9；中文数字、阿拉伯数字都认；认不出给 null
export function 认届次(文字) {
  const m = String(文字 ?? '').match(/第\s*(\d+|[零〇一二两三四五六七八九十百千]+)\s*届/);
  return m ? 中文转数(m[1]) : null;
}
