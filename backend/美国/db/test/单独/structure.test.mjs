// 数据库总管：每部分都有说明、入口能用、引用规矩。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { importsOf, relTo, walk } from '../../../../共用/test/复用/扫描引用.mjs';
import * as db from '../../index.mjs';

const DB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACKEND_DIR = path.resolve(DB_DIR, '..', '..');

describe('目录', () => {
  test('每部分都有说明', () => {
    for (const dir of ['', '描述', '操作', '结构', '导出', '建库', '维护']) {
      expect(fs.existsSync(path.join(DB_DIR, dir, 'README.md')), `${dir || 'db'}/README.md`).toBe(true);
    }
  });
  test('入口导出打开主库和三组常用操作', () => {
    expect(typeof db.openDb).toBe('function');
    expect(Object.keys(db)).toEqual(expect.arrayContaining(['比赛', '届次', 'DbError', 'TABLES', 'buildCreateSql']));
    expect(Object.keys(db)).not.toContain('回收站');   // 回收站是后台的功能，比赛库只给通用的删除接口
  });
});

describe('引用规矩', () => {
  const violations = [];
  // 比赛库本身（描述、操作、结构、导出、建库、入口）：不依赖任何人，只用 共用/db 和 共用/工具；也不引用维护
  // 维护（维护/）：住在比赛库里，但像外人一样只经 db/index.mjs 用比赛库；另外只能用 AI 总管、抓网页、程序审核、补字段的入口和 共用/工具（2026-11-01 用户定；补字段 11-03 加）
  const 维护可用 = ['index.mjs', '../ai/index.mjs', '../web/index.mjs', '../程序审核/index.mjs', '../补字段/index.mjs'];   // 补字段：2026-11-03 和每晚流程共用的 Codex 补字段
  for (const file of walk(DB_DIR)) {
    const from = relTo(DB_DIR, file);
    for (const target of importsOf(file)) {
      const to = relTo(DB_DIR, target);
      if (from.startsWith('维护/')) {
        if (!(to.startsWith('维护/') || 维护可用.includes(to) || to.startsWith('../../共用/工具/'))) violations.push(`${from} 引用了 ${to}（维护只经 db/index.mjs 用比赛库，另外只能用 AI 总管、抓网页、程序审核的入口和 共用/工具）`);
        continue;
      }
      const shared = ['../../共用/db/index.mjs', '../../共用/db/字段类型.mjs'].includes(to) || to.startsWith('../../共用/工具/');
      if (to.startsWith('维护/')) violations.push(`${from} 引用了维护的 ${to}（比赛库不反过来引用维护）`);
      else if (to.startsWith('..') && !shared) violations.push(`${from} 引用了比赛库外面的 ${to}（外面只能用 共用/db/index.mjs、共用/db/字段类型.mjs、共用/工具/）`);
      if (from.startsWith('描述/') && !to.startsWith('描述/') && to !== '../../共用/db/字段类型.mjs') violations.push(`${from} 引用了 ${to}（描述只放数据，只能用字段类型）`);
    }
  }
  // 后端其他地方只能经入口用数据库总管
  for (const file of walk(BACKEND_DIR).filter(f => relTo(DB_DIR, f).startsWith('..'))) {   // db/ 以外的文件
    for (const target of importsOf(file)) {
      const to = relTo(BACKEND_DIR, target);
      if (to.startsWith('美国/db/维护/')) violations.push(`${relTo(BACKEND_DIR, file)} 引用了维护的 ${to}（维护自己跑，寻找流程、后台都不引用它）`);
      else if (to.startsWith('美国/db/') && to !== '美国/db/index.mjs') violations.push(`${relTo(BACKEND_DIR, file)} 直接引用了比赛库内部的 ${to}`);
      if (to.startsWith('共用/db/') && to !== '共用/db/index.mjs' && !relTo(BACKEND_DIR, file).startsWith('共用/db/')) violations.push(`${relTo(BACKEND_DIR, file)} 直接引用了数据库通用部分内部的 ${to}（要经 共用/db/index.mjs）`);
    }
  }
  test('没有违反引用规矩', () => expect(violations).toEqual([]));
});
