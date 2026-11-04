// 沟通：每条来往都有说明和两端；还没实现的明确报错；引用规矩。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { importsOf, relTo, walk } from '../../../共用/test/复用/扫描引用.mjs';

const TALK_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACKEND_DIR = path.resolve(TALK_DIR, '..');
const CHANNELS = ['代读网页', '公开比赛同步', '用户数据同步', '审核结果回传'];

describe('来往', () => {
  test('四条来往，每条都有 README.md、美国端.mjs、北京端.mjs', () => {
    const folders = fs.readdirSync(TALK_DIR, { withFileTypes: true }).filter(d => d.isDirectory() && d.name !== 'test').map(d => d.name);
    expect(folders.sort()).toEqual([...CHANNELS].sort());
    for (const c of CHANNELS) for (const f of ['README.md', '美国端.mjs', '北京端.mjs']) expect(fs.existsSync(path.join(TALK_DIR, c, f)), `${c}/${f}`).toBe(true);
  });
  test('还没实现的两端会明确报错，不会悄悄返回假结果（只剩代读网页没实现）', async () => {
    for (const c of CHANNELS.filter(名 => 名 === '代读网页')) for (const side of ['美国端', '北京端']) {
      const mod = await import(`../../${c}/${side}.mjs`);
      const [fn] = Object.values(mod);
      await expect(fn({}, {}), `${c}/${side}`).rejects.toThrow('还没实现');
    }
  });
});

describe('引用规矩', () => {
  const violations = [];
  for (const file of walk(TALK_DIR)) {
    for (const target of importsOf(file)) {
      const to = relTo(BACKEND_DIR, target);
      // 报错库是北京收集报错自己的库文件（匿名，不进副数据库），用户数据同步要读它（2026-11-02）
      const allowed = to.startsWith('沟通/') || to.startsWith('共用/工具/') || ['共用/db/index.mjs', '美国/db/index.mjs', '北京/主数据库/index.mjs', '北京/副数据库/index.mjs', '北京/服务/收集报错/报错库.mjs'].includes(to);
      if (!allowed) violations.push(`${relTo(BACKEND_DIR, file)} 引用了 ${to}`);
    }
  }
  test('没有违反引用规矩', () => expect(violations).toEqual([]));
});
