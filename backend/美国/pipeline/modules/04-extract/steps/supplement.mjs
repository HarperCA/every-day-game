// 第 5 步 补读：关键信息（参赛对象、报名时间）还缺时，读页面里还没读过的通知链接（读正文交回的 余下通知），最多 2 个，
// 读到第一个有正文的就用：通知在前、原页面在后，再抽一次；补读后关键字段更多才换用（index.mjs 里比）。
// 旧代码是拿页面上的公告标题去搜索再挑官网那份；现在读网页已经给出了同站的通知链接，直接读，不用搜索、不占搜索额度（2026-11-01 用户定）。
// 识别页面图片里的文字不做：靠图片补出来的到 05 审核一律丢掉（没法逐字核对原网页）。
//
// 交回 { used: true, text, noticeUrl, reason: '' } 或 { used: false, reason }
const 最多读 = 2;
const 通知最少字 = 100;
const 通知最多字 = 3800;
const 原页面最多字 = 2000;

export async function supplement({ text, source }, ctx) {
  const 链接们 = (source?.余下通知 || []).slice(0, 最多读);
  if (!链接们.length) return { used: false, reason: '页面里没有别的通知链接' };
  for (const 链接 of 链接们) {
    const r = await ctx.web.读网页(链接.url, { signal: ctx.signal });
    if (r.status !== '成功' || r.text.length < 通知最少字) continue;
    return {
      used: true,
      noticeUrl: r.finalUrl,
      reason: '',
      text: `来源：通知《${链接.text}》 ${r.finalUrl}\n${r.text.slice(0, 通知最多字)}\n\n来源：官网页面 ${source.url}\n${String(text).slice(0, 原页面最多字)}`,
    };
  }
  return { used: false, reason: '通知链接都没读到正文' };
}
