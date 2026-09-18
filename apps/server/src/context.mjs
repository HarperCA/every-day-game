// 每个请求自己的上下文（当前是谁、这次调用的来源）。
//
// 为什么用 AsyncLocalStorage 而不是模块级变量：处理函数是 async 的，
// 两个请求会在 await 处交错执行。模块级变量会被后来的请求覆盖，
// 结果就是 A 用户读到 B 用户的数据——这种串号是最难查、后果最严重的 bug。
// AsyncLocalStorage 天生按调用链隔离，不会串。
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

export function runWithContext(context, fn) {
  return storage.run(context, fn);
}

export function currentContext() {
  return storage.getStore() || null;
}

// 云函数里 cloud.getWXContext() 拿到的东西。没有身份时不返回空对象，
// 而是让调用方自己判断——userData 里 `if (!OPENID) throw unauthenticated`
// 这类判断要能照常生效。
export function currentWXContext() {
  const context = currentContext();
  return {
    OPENID: context?.openid || '',
    APPID: context?.appid || '',
    UNIONID: context?.unionid || '',
  };
}
