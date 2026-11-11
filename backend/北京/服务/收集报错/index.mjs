// 收集报错：搬自上海云函数 clientLog（2026-11-02），去掉云函数的兼容外壳。说明见同目录 README.md。
// 小程序出问题时匿名上报（加载失败、加载慢、登录收藏提醒失败、程序报错）；只收白名单里的字段、逐个截断（sanitize.js 原样），
// 不记 IP、微信身份——入口就算给了 openid 也不存。存进收集报错自己的库文件（报错库.mjs）。
//
//   handle({ events }, { 报错库, now }) → { ok: true, saved } 或 { ok: false, message }
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sanitizeEvents } = require('./sanitize.js');

export async function handle(request = {}, { 报错库, now = () => new Date() } = {}) {
  try {
    const events = sanitizeEvents(request.events, now().toISOString());
    return { ok: true, saved: 报错库.收下(events) };
  } catch (error) {
    return { ok: false, message: String(error?.message || error).slice(0, 200) };
  }
}
