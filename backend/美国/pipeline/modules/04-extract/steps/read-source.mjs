// 第 1 步 读正文：只用读网页的现成工具（2026-11-01 用户定）。读详情页，再从读网页分好类的链接里挑报名入口、通知、附件，
// 按读网页排好的顺序读最多 3 个（PDF、Word 读网页自己会读），拼成一份正文。不再让 Jev 挑链接。
// 正文太短（多半是脚本加载的空壳页）也照样交回：抽取判出空壳，交给第 3 步重读。
// 还没读的通知链接交回去，第 5 步补读用。平台比赛（天池、辽宁平台）等平台脚本写好再接。
//
// 交回 { ok: true, text, url, 读过: [网址], 余下通知: [{ url, text, kind }] } 或 { ok: false, retryable, reason }
//   retryable：网络、超时、对方 5xx（读网页的 isRetryable），这类标“顺延”，下一晚再读；否则标“失败”。
import { isRetryable } from '../../../../web/index.mjs';

const 跟读的类 = ['通知', '附件', '报名入口'];
const 最多跟读 = 3;
const 详情页最多字 = 14000;
const 链接页最多字 = 8000;
const 合计最多字 = 30000;
const 读到了 = r => r.status === '成功' && r.text;

export async function readSource(item, ctx) {
  const url = String(item.data?.url || '');
  if (!url) return { ok: false, retryable: false, reason: '没有网址' };
  const 主页 = await ctx.web.读网页(url, { signal: ctx.signal });
  if (!['成功', '正文太短'].includes(主页.status)) return { ok: false, retryable: isRetryable(主页), reason: `${主页.status}：${主页.error}` };

  const 段们 = [`来源页面：${主页.finalUrl}\n${主页.text.slice(0, 详情页最多字)}`];
  const 读过 = [主页.finalUrl];
  const 候选链接 = (主页.links || []).filter(l => 跟读的类.includes(l.kind) && l.url !== url && l.url !== 主页.finalUrl);
  const 要读 = 候选链接.slice(0, 最多跟读);
  for (const 链接 of 要读) {
    const r = await ctx.web.读网页(链接.url, { signal: ctx.signal });
    if (!读到了(r)) continue;
    段们.push(`链接（${链接.kind}）：${链接.text}；实际网址：${r.finalUrl}\n${r.text.slice(0, 链接页最多字)}`);
    读过.push(r.finalUrl);
  }
  return {
    ok: true,
    text: 段们.join('\n\n').slice(0, 合计最多字),
    url: 主页.finalUrl,
    读过,
    余下通知: 候选链接.slice(最多跟读).filter(l => l.kind === '通知'),
  };
}
