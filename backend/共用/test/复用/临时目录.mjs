// 测试用：在系统临时目录里建一个新的空文件夹，测试写文件时用，不碰仓库里的任何目录。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function tempRoot(prefix = 'backend-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
