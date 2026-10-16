// 测试名单：服务器上一个文本文件，一行一个 openid，# 开头是注释。
// openid 不进仓库（是用户标识），只在服务器上。文件不存在或为空 = 谁都不放行。
const fs = require('fs');
const CACHE_MS = 60 * 1000;   // 改了名单，最多一分钟生效，不用重启服务
let cache = { at:0, file:'', set:new Set() };

function readTesters(file) {
  if (!file || !fs.existsSync(file)) return new Set();
  return new Set(fs.readFileSync(file, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')));
}

function isTester(openid, { file = process.env.ASSISTANT_TESTERS_FILE, now = Date.now() } = {}) {
  if (!openid) return false;
  if (cache.file !== file || now - cache.at > CACHE_MS) cache = { at:now, file, set:readTesters(file) };
  return cache.set.has(openid);
}

module.exports = { isTester, readTesters, CACHE_MS };
