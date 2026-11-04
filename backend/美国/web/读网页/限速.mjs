// 同一网站限速：同一个网站两次下载之间至少隔开一段时间（默认 1.5 秒，和旧抓取器一样），不给主办方网站添压力。
// 读网页 在下载前调 等候(网站)；同时来的几次按先来后到排开，不同网站互不影响。搬自 crawler/lib/fetcher.mjs 的 throttle。
//
//   建限速({ 间隔 }) → { 等候(网站) }
//   默认限速：进程里共用一个，所以不管哪个模块、同时开多少个读取，同一网站的间隔都管得住
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function 建限速({ 间隔 = 1500 } = {}) {
  const 下次可读 = new Map();
  return {
    async 等候(网站) {
      const 现在 = Date.now();
      const 轮到 = Math.max(现在, 下次可读.get(网站) ?? 0);
      下次可读.set(网站, 轮到 + 间隔);
      if (轮到 > 现在) await sleep(轮到 - 现在);
    },
  };
}

export const 默认限速 = 建限速();
