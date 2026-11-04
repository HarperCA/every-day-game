// 测试配置：从 backend/ 开始找测试，只跑每个 test/单独/ 里的 *.test.mjs（test/复用/ 里是测试工具，不是测试）；
// 缓存放在 Environment/node_modules/ 里，backend/ 下不会多出 node_modules。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.resolve(HERE, '..'),
  cacheDir: path.join(HERE, 'node_modules', '.vite'),
  test: {
    include: ['**/test/单独/**/*.test.mjs'],
    exclude: ['**/node_modules/**', 'Environment/**'],
  },
});
