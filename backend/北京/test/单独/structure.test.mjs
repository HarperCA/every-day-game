// 北京：每项服务都有说明和入口；新增服务受登录保护；引用规矩。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { importsOf, relTo, walk } from '../../../共用/test/复用/扫描引用.mjs';

const BEIJING_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACKEND_DIR = path.resolve(BEIJING_DIR, '..');
const SERVICES = path.join(BEIJING_DIR, '服务');

describe('服务', () => {
  const folders = fs.readdirSync(SERVICES, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
  test('北京自己的 7 项服务，每项都有 README.md 和 index.mjs（和美国来往的在 沟通/）', () => {
    expect(folders.sort()).toEqual(['公开数据', '发提醒', '收集报错', '校赛', '用户数据', '登录', '组队'].sort());
    for (const f of folders) for (const file of ['README.md', 'index.mjs']) expect(fs.existsSync(path.join(SERVICES, f, file)), `${f}/${file}`).toBe(true);
  });
  test.each(['校赛', '组队'])('%s 拒绝未登录的请求', async f => {
    const { handle } = await import(`../../服务/${f}/index.mjs`);
    await expect(handle({}, {})).resolves.toMatchObject({ ok: false, message: 'unauthenticated' });
  });
});

describe('引用规矩', () => {
  const violations = [];
  for (const file of walk(BEIJING_DIR)) {
    for (const target of importsOf(file)) {
      const to = relTo(BACKEND_DIR, target);
      const allowed = to.startsWith('北京/') || ['共用/db/index.mjs', '共用/推荐排序/index.mjs'].includes(to) || to.startsWith('共用/工具/');
      if (!allowed) violations.push(`${relTo(BACKEND_DIR, file)} 引用了 ${to}（北京只能用自己的文件、共用/db/index.mjs、共用/推荐排序/index.mjs 和 共用/工具/）`);
    }
  }
  test('没有违反引用规矩', () => expect(violations).toEqual([]));
});
