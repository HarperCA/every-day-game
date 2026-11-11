# 浏览器（无头浏览器）

2026-11-08 新维护用：页面靠脚本加载、要点击才出通知列表的网站，爬虫脚本用无头浏览器（Playwright 的 Chromium，版本 1.50.1，和服务器试验用的一样）打开。

- 只提供函数，由 `../读网页/浏览器.mjs` 包上安全检查后经入口交出去（`建浏览器`）。
- 对外只开放 打开、等待、点击、源码、网址，不开放执行页面脚本。
- 图片、字体、音视频不加载；不接受下载；Service Worker 关掉。一个页面一个浏览环境，用完整个关掉。
- 内网检查（2026-11-08 补漏洞，在 Playwright 1.50.1 上用真浏览器试过，测试 `../test/单独/浏览器.test.mjs` 里有真浏览器的几条，没装浏览器就跳过）：
  - 普通请求：浏览环境上的 `route` 查，内网地址 abort；点出来的新窗口也管。
  - WebSocket：`route` 拦不到，用 `routeWebSocket` 拦所有 ws/wss，按 http/https 地址做同样检查，不安全的直接关掉（1008）。
  - 跳转：`route` 只在第一跳调用（Playwright 文档写明，试验也确认），中间几跳拦不到。所以听浏览环境的 `request` 事件，跳转来的请求都查，
    不安全就关掉整个浏览环境，之后打开、等待、点击、源码都抛“页面请求了不安全的地址：…”。**这时请求已经发出去了**，只能保证读不到内容、页面不能再用。
  - `routeWebSocket` 管不到 Worker 里的 WebSocket，WebRTC、WebTransport 也不走 `route`：页面加载前去掉 Worker、SharedWorker、RTCPeerConnection、WebTransport。
  - 没做：DNS 重新绑定（检查时解析一次、浏览器再解析一次）。要彻底挡住跳转和这类问题，得让浏览器走一个自己写的代理，在代理里查每个连接。
- 浏览器程序要另外装：在 `backend/Environment` 里跑 `npx playwright install chromium-headless-shell`；服务器上可以用 `PLAYWRIGHT_BROWSERS_PATH` 指到已有的目录。
