// 后台界面的服务器端入口（美国服务器上跑）：POST /api/后台/<功能> → 功能目录里那个功能的 数据库.mjs 的 取()。
// 只认 功能目录.mjs 里登记过的功能名，别的一律拒绝。以后正式的美国后端也挂这个函数，不另写一套。
//   处理后台请求(功能名, 参数, { db })  → 取() 交回的数据；功能名不认识时抛错（kind: '找不到'）
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { 功能目录 } from './功能目录.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function 处理后台请求(功能名, 参数, 环境) {
  if (!Object.hasOwn(功能目录, 功能名)) {
    const 错误 = new Error(`没有这个功能：${功能名}`);
    错误.kind = '找不到';
    throw 错误;
  }
  const 地址 = pathToFileURL(path.join(HERE, 功能目录[功能名], '数据库.mjs')).href;
  const 模块 = await import(地址);
  return 模块.取(参数 && typeof 参数 === 'object' ? 参数 : {}, 环境);
}
