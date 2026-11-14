// 建浏览器：给新维护的爬虫脚本用的无头浏览器（2026-11-08）。包上读网页的安全检查（页面里每个请求、WebSocket、跳转都查内网地址，见 ../浏览器/index.mjs）。
//   建浏览器({ 安全检查, 超时, chromium }) → { 新页面() → { 页: { 打开, 等待, 点击, 源码, 网址 }, 关 }, 关() }
// 用完要调 关()；浏览器第一次用到时才启动。
// 只启动一个 Chromium：记住启动的 Promise，并发的都等同一个；启动失败或浏览器自己断开就忘掉，下次重新启动；关() 等启动完再关。
import { 启动浏览器, 新页面 } from '../浏览器/index.mjs';
import { checkUrlSafety } from './安全.mjs';

export function 建浏览器({ 安全检查 = checkUrlSafety, 超时 = 20000, chromium } = {}) {
  let 启动中 = null;
  function 拿浏览器() {
    if (启动中) return 启动中;
    const 这次 = 启动浏览器(chromium ? { chromium } : {}).then(浏览器 => {
      浏览器.on?.('disconnected', () => { if (启动中 === 这次) 启动中 = null; });
      return 浏览器;
    }, error => {
      if (启动中 === 这次) 启动中 = null;
      throw error;
    });
    启动中 = 这次;
    return 这次;
  }
  return {
    async 新页面() {
      return 新页面(await 拿浏览器(), { 安全检查, 超时 });
    },
    async 关() {
      const 这次 = 启动中;
      启动中 = null;
      if (!这次) return;
      const 浏览器 = await 这次.catch(() => null);
      if (浏览器) await 浏览器.close().catch(() => {});
    },
  };
}
