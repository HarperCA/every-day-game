// 第 3 步 空壳页重读：正文只有导航骨架（内容由网页脚本加载）时，经 AI 总管的读网页（Kimi，在服务端执行页面脚本）再读一次。
// 读到 200 字以上才算读到；读到的正文同样要过出处核对，证据仍然可复核。
//
// 交回 { ok: true, text, images } 或 { ok: false, reason }
//
// 来源：run-extract.mjs 里“空壳页经 Kimi 重读”的部分（kimiFetchPage、200 字门槛、正文前面写明来源）。
const MIN_CHARS = 200;

export async function reread(item, ctx) {
  const url = String(item.data?.detailUrl || item.data?.url || '');
  if (!url) return { ok: false, reason: '空壳页，没有网址可以重读' };
  let page;
  try {
    page = await ctx.ai.fetchPage({ purpose: 'reread', url, signal: ctx.signal });
  } catch (error) {
    return { ok: false, reason: `空壳页重读失败：${String(error?.message || error).slice(0, 160)}` };
  }
  if (page.markdown.length < MIN_CHARS) return { ok: false, reason: `空壳页重读后正文只有 ${page.markdown.length} 字` };
  return {
    ok: true,
    text: `来源页面（原站内容由脚本加载，经读网页接口执行脚本后取得正文）：${url}\n${page.markdown}`,
    images: page.images || [],
  };
}
