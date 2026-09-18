// 迁移校验用的规范化哈希。
//
// 为什么不直接 JSON.stringify：它对键顺序敏感。同一条记录，
// 存进去再读出来，键的顺序可能变（比如 _id 从开头挪到末尾），
// 内容一模一样但哈希不同——那会让校验报假警，而假警最坏的后果是
// 让人开始忽略校验结果。
//
// 这里递归把对象的键排序后再序列化，比的是内容本身。
import crypto from 'node:crypto';

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = canonicalize(value[key]);
      return out;
    }, {});
  }
  return value;
}

export function canonicalHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex').slice(0, 16);
}
