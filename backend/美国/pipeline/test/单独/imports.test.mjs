// 依赖方向检查：扫描 pipeline 下所有 .mjs 的 import，违反下面任何一条就失败。
//   1. 模块只能引用自己文件夹里的文件和 shared/，不能引用别的模块，也不能引用总控、run.db 这些
//   2. shared/ 不能引用模块，也不能引用总控这一层的文件（它要能单独拿去别处用）
//   3. 除了 run.mjs 和测试，没有文件引用总控（总控/orchestrator.mjs）
//   4. 总控的零件（总控/零件/）只给总控用：总控以外的文件不能引用，零件也不能引用模块
//   5. 抓网页（美国/web）和 AI 总管只能经入口用；维护（美国/db/维护）和这条流程互不引用
//   6. 小数据库（小数据库/）只经 index.mjs 用，只有总控直接引用；模块经 ctx.小数据库 调它的接口
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { importsOf, relTo, walk } from '../../../../共用/test/复用/扫描引用.mjs';
import { PIPELINE_DIR } from '../../shared/paths.mjs';

const rel = file => relTo(PIPELINE_DIR, file);

describe('依赖方向', () => {
  const files = walk(PIPELINE_DIR);   // 不扫 test/、日志/
  const violations = [];
  for (const file of files) {
    const from = rel(file);
    for (const target of importsOf(file)) {
      const to = rel(target);
      // ../../共用/工具/ 是全后端复用的基础工具，谁都能用
      const backendCommon = to.startsWith('../../共用/工具/');
      if (from.startsWith('modules/')) {
        const own = from.split('/').slice(0, 2).join('/');
        // 流程内复用：common/ 根下的文件（prompt、quotes、candidate）；抓网页、AI 总管、程序审核只能经入口
        const allowed = to.startsWith(own + '/') || to.startsWith('shared/') || /^common\/[^/]+\.mjs$/.test(to)
          || to === '../web/index.mjs' || to === '../ai/index.mjs' || to === '../程序审核/index.mjs' || to === '../补字段/index.mjs' || backendCommon;   // 补字段：2026-11-03 和维护共用
        if (!allowed) violations.push(`${from} 引用了 ${to}（模块只能引用自己文件夹、shared/、common/ 下的文件、../web/index.mjs、../ai/index.mjs、../程序审核/index.mjs、../补字段/index.mjs 和 backend/共用/工具）`);
      }
      if (to.startsWith('../ai/') && to !== '../ai/index.mjs') violations.push(`${from} 直接引用了 AI 总管内部的 ${to}`);
      if (to.startsWith('../程序审核/') && to !== '../程序审核/index.mjs') violations.push(`${from} 直接引用了程序审核内部的 ${to}（要通过 ../程序审核/index.mjs）`);
      if (to.startsWith('../补字段/') && to !== '../补字段/index.mjs') violations.push(`${from} 直接引用了补字段内部的 ${to}（要通过 ../补字段/index.mjs）`);
      if (to.startsWith('../web/') && to !== '../web/index.mjs') violations.push(`${from} 直接引用了抓网页内部的 ${to}（要通过 ../web/index.mjs）`);
      if (to.startsWith('../db/维护/')) violations.push(`${from} 引用了维护已有记录的 ${to}（两边只通过比赛库来往）`);
      if (to.startsWith('小数据库/') && !from.startsWith('小数据库/')) {
        if (to !== '小数据库/index.mjs') violations.push(`${from} 直接引用了小数据库内部的 ${to}（要经 小数据库/index.mjs）`);
        else if (!from.startsWith('总控/')) violations.push(`${from} 引用了小数据库（只有总控直接用；模块经 ctx.小数据库）`);
      }
      if (from.startsWith('小数据库/') && !to.startsWith('小数据库/') && !backendCommon) violations.push(`${from} 引用了 ${to}（小数据库只用自己和 backend/共用/工具）`);
      if (from.startsWith('shared/') && !to.startsWith('shared/')) violations.push(`${from} 引用了 ${to}（shared/ 不能引用外面的文件）`);
      if (to === '总控/orchestrator.mjs' && from !== 'run.mjs') violations.push(`${from} 引用了总控`);
      if (to.startsWith('总控/零件/') && !from.startsWith('总控/')) violations.push(`${from} 引用了总控的零件 ${to}（零件只给总控用）`);
      if (from.startsWith('总控/零件/') && to.startsWith('modules/') && !to.includes('${')) violations.push(`${from} 引用了模块 ${to}（模块由模块清单按名字加载，不直接引用）`);
    }
  }
  test('没有违反依赖方向的引用', () => expect(violations).toEqual([]));
  test('确实扫描到了文件', () => expect(files.length).toBeGreaterThan(10));
  test('run.db 和交接检查不再是总控的零件', () => {
    for (const f of ['rundb.mjs', 'handoff.mjs']) expect(fs.existsSync(path.join(PIPELINE_DIR, '总控', '零件', f)), f).toBe(false);
  });
});
