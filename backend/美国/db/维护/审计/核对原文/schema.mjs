// 核对原文 · Codex 要交回的格式（和 prompt.md 的示例一致）。检查() 交回用不了的地方，null 表示合格。
export const 结论们 = ['通过', '继续', '不收', '查不到'];
export const 来源性质们 = ['官方', '学校通知', '判断不了'];
export const 不收类别 = ['不是比赛', '不含大学生', '已停办', '水赛', '校内赛'];

const 是字符串 = v => typeof v === 'string';
const 文字 = { type: 'string' };
const 依据 = { type: 'object', additionalProperties: false, required: ['字段', '网址', '原文'], properties: { 字段: 文字, 网址: 文字, 原文: 文字 } };

// 交给 Codex 的 --output-schema，固定交回的格式（2026-11-06 试审发现不固定时 名称 常常写错）
export const 输出格式 = {
  type: 'object', additionalProperties: false,
  required: ['结论', '理由', '来源性质', '名称', '字段们', '待公布', '不收', '搜索摘要'],
  properties: {
    结论: { type: 'string', enum: 结论们 },
    理由: 文字,
    来源性质: { type: 'string', enum: 来源性质们 },
    名称: { type: 'object', additionalProperties: false, required: ['对不对', '改正'], properties: { 对不对: { type: 'boolean' }, 改正: 文字 } },
    字段们: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['字段', '值', '网址', '原文'],
      properties: { 字段: 文字, 值: { anyOf: [文字, { type: 'array', items: 文字 }] }, 网址: 文字, 原文: 文字 } } },
    待公布: { type: 'array', items: 依据 },
    不收: { type: 'object', additionalProperties: false, required: ['类别', '网址', '原文'], properties: { 类别: 文字, 网址: 文字, 原文: 文字 } },
    // 结论是“继续”时交给下一轮（2026-11-06 用户定）；其他结论留空
    搜索摘要: { type: 'object', additionalProperties: false, required: ['进度', '下一轮从哪里开始'], properties: { 进度: 文字, 下一轮从哪里开始: 文字 } },
  },
};

export function 检查(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return '没有交回 JSON 对象';
  if (!结论们.includes(data.结论)) return `“结论”「${data.结论}」不是 ${结论们.join('/')} 之一`;
  if (!是字符串(data.理由) || !data.理由.trim()) return '“理由”要写，不能空（AI 删除要说明理由）';
  if (!来源性质们.includes(data.来源性质)) return `“来源性质”「${data.来源性质}」不是 ${来源性质们.join('/')} 之一`;
  if (typeof data.名称?.对不对 !== 'boolean') return '“名称.对不对”要填 true 或 false';
  if (!Array.isArray(data.字段们)) return '“字段们”要是列表';
  for (const 项 of data.字段们) if (!是字符串(项?.字段) || !是字符串(项?.网址) || !是字符串(项?.原文)) return '“字段们”每一项要有 字段、网址、原文';
  if (!Array.isArray(data.待公布 ?? [])) return '“待公布”要是列表';
  for (const 项 of data.待公布 ?? []) if (!是字符串(项?.字段) || !是字符串(项?.网址) || !是字符串(项?.原文)) return '“待公布”每一项要有 字段、网址、原文';
  if (data.结论 === '不收') {
    if (!不收类别.includes(data.不收?.类别)) return `“不收.类别”「${data.不收?.类别}」不是 ${不收类别.join('/')} 之一`;
    if (!是字符串(data.不收.网址) || !是字符串(data.不收.原文)) return '“不收”要有 网址、原文';
  }
  if (data.结论 === '继续') {
    if (!是字符串(data.搜索摘要?.进度) || !data.搜索摘要.进度.trim()) return '结论是继续时“搜索摘要.进度”不能空';
    if (!是字符串(data.搜索摘要.下一轮从哪里开始) || !data.搜索摘要.下一轮从哪里开始.trim()) return '结论是继续时“搜索摘要.下一轮从哪里开始”不能空';
  }
  return null;
}
