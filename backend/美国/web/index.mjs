// 抓网页的唯一入口：只给一个总函数 读网页。寻找流程的模块、维护都只从这里拿，不直接引用里面的文件。
//
//   读网页(网址, 选项)   读一个网页（网页、PDF、Word），交回统一结果；同一网站的间隔在里面统一管，要读多个就自己并发调用
//   取源码(网址, 选项)   网页的 HTML 源码，可带上次的 etag、最后修改问有没有更新（新维护的爬虫脚本用，2026-11-08）
//   建浏览器(选项)      无头浏览器，只开放打开、等待、点击、源码（新维护的爬虫脚本用，2026-11-08）
//   normalizeUrl        网址规范化（01 搜索合并同一网址的结果用）
//   带北京兜底({ 读网页, 取源码, 代读 })   网络问题读不到时改请北京代读一次（2026-11-09；浏览器不经北京）
//   代读(网址, 选项)    请北京代读，实现在 沟通/代读网页/美国端.mjs，这里转出去给新维护用（新维护只能经 web 入口拿读网页的东西）
//   STATUSES、LINK_KINDS、MIN_TEXT_CHARS、checkResult、isRetryable   结果的状态、链接种类、检查
//
// 里面：读网页/ 是总函数（流程、限速、网址、安全、结果格式）；下载/、编码/、正文/、pdf/、word/、浏览器/ 只提供函数给它调用。
export { 读网页 } from './读网页/index.mjs';
export { 取源码 } from './读网页/源码.mjs';
export { 建浏览器 } from './读网页/浏览器.mjs';
export { 带北京兜底 } from './读网页/北京兜底.mjs';
export { 代读 } from '../../沟通/代读网页/美国端.mjs';
export { normalizeUrl } from './读网页/网址.mjs';
export { STATUSES, LINK_KINDS, MIN_TEXT_CHARS, checkResult, isRetryable } from './读网页/结果.mjs';
