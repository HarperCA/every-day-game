// Codex 能用的工具（试验，2026-11-07 用户要验证）：只有搜索和读页，没有点击、填表、执行脚本。
//   建工具({ 搜索, 读页, 屏蔽了, 上限, 片段字数, 链接数 }) → { 开一轮, 调用, 页, 记录 }
//     开一轮(轮号, { 名称 })          每次 Codex 运行是一轮，次数单独算
//     调用(轮号, 工具名, 参数)        → { 文字, 出错 }；次数超了、屏蔽站直接拒绝，不真的去搜、去读
//     页(网址)                       程序核对用：Codex 看的那份全文，按原网址、最终网址都能找到
//     记录(轮号)                     { 搜索, 读页, 交回字数 }
// 工具名只能用英文（OpenAI 的函数名只收 a-z0-9_-）。
import { 截取片段, 筛链接 } from './片段.mjs';

export const 工具定义 = [
  { name: 'search', description: '按关键词搜索网页，交回标题、网址、摘要。每轮只能用 1 次。', inputSchema: { type: 'object', properties: { query: { type: 'string', description: '搜索词' } }, required: ['query'] } },
  { name: 'read_page', description: '打开一个网页，交回和比赛有关的段落（原文，没有改动）和页面里的通知、附件、报名链接。支持 PDF、Word。每轮最多 3 个，读过的再读不算次数。', inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'http 或 https 网址' } }, required: ['url'] } },
];

const 最多结果 = 8;
const 摘要字数 = 120;
const 读到了 = 页 => ['成功', '正文太短'].includes(页.status);

export function 建工具({ 搜索, 读页, 屏蔽了 = () => false, 上限 = { 搜索: 1, 读页: 3 }, 片段字数 = 2500, 链接数 = 8 }) {
  const 轮们 = new Map();
  const 页们 = new Map();

  const 写读页结果 = (页, 名称) => {
    if (!读到了(页)) return `读不到：${页.status}${页.httpStatus ? ` ${页.httpStatus}` : ''}${页.error ? `（${String(页.error).slice(0, 80)}）` : ''}。不要重试，也不要换网址变体。`;
    const { 片段, 总字数, 显示字数 } = 截取片段(页.text, { 名称, 上限: 片段字数 });
    const 链接们 = 筛链接(页.links, { 名称, 上限: 链接数 });
    return [`标题：${页.title || ''}`, `网址：${页.finalUrl || 页.url}`, `全文 ${总字数} 字，这里显示 ${显示字数} 字（原文，可以直接引用）：`, 片段,
      ...(链接们.length ? ['页面里的链接：', ...链接们.map(l => `- ${l.text}：${l.url}`)] : [])].join('\n');
  };

  async function 执行(轮, 工具, 参数) {
    if (工具 === 'search') {
      if (轮.搜索 >= 上限.搜索) return { 文字: `这一轮的搜索次数用完了（最多 ${上限.搜索} 次），马上交回结论。`, 出错: true };
      轮.搜索 += 1;
      let 结果;
      try { 结果 = await 搜索(String(参数?.query || '')); } catch (错) { return { 文字: `搜索失败：${String(错?.message || 错).slice(0, 120)}。不要重试，按现有资料交回结论。`, 出错: true }; }
      const 留下 = (结果 || []).filter(r => r.url && !屏蔽了(r.url)).slice(0, 最多结果);
      if (!留下.length) return { 文字: '没有搜到可用的结果。', 出错: false };
      return { 文字: 留下.map((r, i) => `${i + 1}. ${r.title || ''}\n${r.url}\n${String(r.content || '').slice(0, 摘要字数)}`).join('\n'), 出错: false };
    }
    if (工具 === 'read_page') {
      const 网址 = String(参数?.url || '').trim();
      if (!/^https?:\/\//i.test(网址)) return { 文字: '网址要以 http 或 https 开头。', 出错: true };
      if (屏蔽了(网址)) return { 文字: '这个网站在屏蔽名单里，不能作为依据，不要再读。', 出错: true };
      if (页们.has(网址)) return { 文字: 写读页结果(页们.get(网址), 轮.名称), 出错: false };
      if (轮.读页 >= 上限.读页) return { 文字: `这一轮的读页次数用完了（最多 ${上限.读页} 个），马上交回结论。`, 出错: true };
      轮.读页 += 1;
      const 页 = await 读页(网址);
      页们.set(网址, 页);
      if (页.finalUrl) 页们.set(页.finalUrl, 页);
      return { 文字: 写读页结果(页, 轮.名称), 出错: false };
    }
    return { 文字: `没有这个工具：${工具}`, 出错: true };
  }

  return {
    开一轮(轮号, { 名称 = '' } = {}) { 轮们.set(轮号, { 名称, 搜索: 0, 读页: 0, 交回字数: 0 }); },
    async 调用(轮号, 工具, 参数) {
      const 轮 = 轮们.get(轮号);
      if (!轮) return { 文字: '这一轮没有开始。', 出错: true };
      const 回 = await 执行(轮, 工具, 参数);
      轮.交回字数 += 回.文字.length;
      return 回;
    },
    页: 网址 => 页们.get(String(网址 || '').trim()),
    记录(轮号) { const { 搜索, 读页: 读, 交回字数 } = 轮们.get(轮号) || {}; return { 搜索, 读页: 读, 交回字数 }; },
  };
}
