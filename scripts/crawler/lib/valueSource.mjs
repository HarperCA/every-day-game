// competitionValue.js 在仓库里的规范位置是云函数目录（apps/miniprogram/
// cloudfunctions/adminData/），但抓取脚本部署到服务器后单独运行，
// 那个目录整个不存在——sync-extract.sh 已经把它的副本放在服务器的
// ../cjs/ 里（抽取模块要用同一份档位算法，避免抓取和抽取落在不同档位）。
//
// 两边都不重复维护逻辑：哪个路径能找到就用哪个，找不到才报错。
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));

function tryRequire(relativePath) {
  try {
    return require(path.join(HERE, relativePath));
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    return null;
  }
}

const module_ = tryRequire('../../../apps/miniprogram/cloudfunctions/adminData/competitionValue.js') // 仓库内运行
  || tryRequire('../../cjs/competitionValue.js'); // 服务器部署后运行（sync-extract.sh 同步的副本）

if (!module_) {
  throw new Error('competitionValue.js 在仓库路径和服务器 cjs/ 路径均未找到——先跑一次 sync-extract.sh 或检查目录结构');
}

export const { deriveRewardTier, deriveScaleTier } = module_;
