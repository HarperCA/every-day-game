// 补字段的引用规矩：每晚流程和维护都用它，所以它自己不引用两边任何一个，也不直接引用 AI 总管、抓网页（经调用方给的 ctx 用）；
// 只用自己文件夹里的文件和 backend/共用/工具/。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { importsOf, relTo, walk } from '../../../../共用/test/复用/扫描引用.mjs';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACKEND = path.resolve(DIR, '..', '..');

test('补字段只引用自己和 共用/工具', () => {
  const 越界 = [];
  for (const file of walk(DIR).filter(f => !f.includes(`${path.sep}test${path.sep}`))) {
    for (const target of importsOf(file)) {
      const to = relTo(BACKEND, target);
      if (!(to.startsWith('美国/补字段/') || to.startsWith('共用/工具/'))) 越界.push(`${relTo(BACKEND, file)} 引用了 ${to}`);
    }
  }
  expect(越界).toEqual([]);
});
