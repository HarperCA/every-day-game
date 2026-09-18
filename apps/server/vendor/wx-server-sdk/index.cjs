// 云函数里 require('wx-server-sdk') 拿到的就是这个模块。
//
// 它自己不含任何逻辑，只是把调用转给服务器启动时装进来的实现
// （src/index.mjs 里 installCloudImplementation(...)）。
// 这样云函数代码一行不用改，require 的名字也不用改。
//
// 没装实现就调用会直接抛错，而不是返回一个假的空实现——
// 假装成功会让「数据根本没写进去」这种问题被藏起来。
let implementation = null;

function requireImplementation() {
  if (!implementation) {
    throw new Error('cloud_implementation_not_installed:服务器启动时未注入 SQLite 外壳');
  }
  return implementation;
}

module.exports = {
  install(impl) { implementation = impl; },
  init(...args) { return requireImplementation().init(...args); },
  database(...args) { return requireImplementation().database(...args); },
  getWXContext(...args) { return requireImplementation().getWXContext(...args); },
  get DYNAMIC_CURRENT_ENV() { return requireImplementation().DYNAMIC_CURRENT_ENV; },
  get openapi() { return requireImplementation().openapi; },
};
