// 与云函数共用同一份 robots.txt 实现，避免两处逻辑漂移。
// 部署时把 apps/miniprogram/cloudfunctions/adminData/robots.js 复制为同目录下的 robots.cjs
// （见 scripts/crawler/deploy.sh）；该实现有 7 项测试覆盖，见 tests/robots.test.mjs。
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DEFAULT_USER_AGENT, isAllowed, parseGroups, pickGroup } = require('./robots.cjs');

export { DEFAULT_USER_AGENT, isAllowed, parseGroups, pickGroup };
