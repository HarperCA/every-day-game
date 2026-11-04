// 抓网页的唯一入口：只给一个总函数 读网页。寻找流程的模块、维护都只从这里拿，不直接引用里面的文件。
//
//   读网页(网址, 选项)   读一个网页（网页、PDF、Word），交回统一结果；同一网站的间隔在里面统一管，要读多个就自己并发调用
//   normalizeUrl        网址规范化（01 搜索合并同一网址的结果用）
//   STATUSES、LINK_KINDS、MIN_TEXT_CHARS、checkResult、isRetryable   结果的状态、链接种类、检查
//
// 里面：读网页/ 是总函数（流程、限速、网址、安全、结果格式）；下载/、编码/、正文/、pdf/、word/ 只提供函数给它调用。
export { 读网页 } from './读网页/index.mjs';
export { normalizeUrl } from './读网页/网址.mjs';
export { STATUSES, LINK_KINDS, MIN_TEXT_CHARS, checkResult, isRetryable } from './读网页/结果.mjs';
