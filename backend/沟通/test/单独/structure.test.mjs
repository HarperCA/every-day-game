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
  // 2026-11-09 代读网页做完，四条来往都能用了；各自的行为测试在每个文件夹的 test/ 里
});

describe('引用规矩', () => {
  const violations = [];
  for (const file of walk(TALK_DIR)) {
    for (const target of importsOf(file)) {
      const to = relTo(BACKEND_DIR, target);
      // 报错库是北京收集报错自己的库文件（匿名，不进副数据库），用户数据同步要读它（2026-11-02）
      // 代读网页的北京端直接用 美国/web 的 读网页、取源码（2026-11-09）：安全检查、robots、爬虫身份、读正文和美国是同一份代码；
      // 北京打包时要带上 美国/web（不带 test），见 代读网页/README.md。只放 代读网页/ 这一个文件夹、只放 web 的入口
      const 代读用web = relTo(BACKEND_DIR, file).startsWith('沟通/代读网页/') && to === '美国/web/index.mjs';
      const allowed = 代读用web || to.startsWith('沟通/') || to.startsWith('共用/工具/') || ['共用/db/index.mjs', '美国/db/index.mjs', '北京/主数据库/index.mjs', '北京/副数据库/index.mjs', '北京/服务/收集报错/报错库.mjs'].includes(to);
      if (!allowed) violations.push(`${relTo(BACKEND_DIR, file)} 引用了 ${to}`);
    }
  }
  test('没有违反引用规矩', () => expect(violations).toEqual([]));
});
