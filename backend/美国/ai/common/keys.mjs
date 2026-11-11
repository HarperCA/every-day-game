// 读 AI 密钥：只有这里能读。密钥放在一个密钥目录里，每家一个文件（deepseek.key、codex.key），不进 git。
// 密钥目录由环境变量 AI_KEYS_DIR 指定；也可以用环境变量 AI_KEY_DEEPSEEK 这样直接给（测试和本地试跑方便）。
// 报错信息、日志里出现的密钥一律打码。
import fs from 'node:fs';
import path from 'node:path';
import { AiError } from './errors.mjs';

export function createKeyStore({ dir = process.env.AI_KEYS_DIR || '', env = process.env } = {}) {
  const cache = new Map();
  function get(provider) {
    if (cache.has(provider)) return cache.get(provider);
    let key = String(env[`AI_KEY_${provider.toUpperCase()}`] || '').trim();
    if (!key && dir) {
      try { key = fs.readFileSync(path.join(dir, `${provider}.key`), 'utf8').replace(/^﻿/, '').trim().replace(/^[A-Z_]+=/, '').trim(); } catch { /* 下面统一报 */ }
    }
    if (!key) throw new AiError('密钥错误', `没有 ${provider} 的密钥（密钥目录或环境变量里都没找到）`, { provider });
    cache.set(provider, key);
    return key;
  }
  // 把文字里出现的已读密钥换成打码形式
  function mask(text) {
    let out = String(text ?? '');
    for (const key of cache.values()) if (key.length >= 8) out = out.split(key).join(`${key.slice(0, 3)}…${key.slice(-2)}`);
    return out;
  }
  return { get, mask };
}
