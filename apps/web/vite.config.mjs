// 网页测试版的构建配置。本目录没有自己的依赖，借用管理后台装好的 vite：
//   构建：apps/admin/node_modules/.bin/vite build apps/web
//   本地预览：apps/admin/node_modules/.bin/vite apps/web   （接口转发到线上服务器，本地不上报统计）
// 产物在 apps/web/dist，部署到服务器 /var/www/web-test，由 nginx 以 /app/ 提供。
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default {
  root,
  base: '/app/',
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },   // 允许引用 apps/miniprogram 里的共享代码
    proxy: { '/api': { target: 'https://107-175-111-18.sslip.io', changeOrigin: true } },
  },
};
