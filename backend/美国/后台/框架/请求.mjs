// 浏览器向美国后台取数据，只经这里：请求('失败任务', 参数) → POST api/后台/失败任务（相对地址，挂在 /new-admin/ 下面也能用），
// 服务器那边由 接口.mjs 找到 功能/…/数据库.mjs 的 取() 去读数据库，交回 JSON。
// 服务器回“要先登录”（401）时弹登录框（登录框.mjs），登录成功后再发一次。
import { 要登录 } from './登录框.mjs';

async function 发一次(功能id, 参数) {
  const 回应 = await fetch(`./api/后台/${encodeURIComponent(功能id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(参数),
  });
  let 内容 = null;
  try { 内容 = await 回应.json(); } catch { /* 出错时可能不是 JSON */ }
  return { 回应, 内容 };
}

// 交口令给服务器（登录框调）：成功后服务器发会话 cookie
async function 交口令(口令) {
  const 回应 = await fetch('./api/登录', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ 口令 }) });
  const 内容 = await 回应.json().catch(() => null);
  if (!回应.ok || !内容?.ok) throw new Error(内容?.错误 || `登录失败（${回应.status}）`);
}

export async function 请求(功能id, 参数 = {}) {
  let { 回应, 内容 } = await 发一次(功能id, 参数);
  if (回应.status === 401 && 内容?.要登录) {
    await 要登录(交口令);
    ({ 回应, 内容 } = await 发一次(功能id, 参数));
  }
  if (!回应.ok || !内容?.ok) throw new Error(内容?.错误 || `接口返回 ${回应.status}`);
  return 内容.数据;
}
