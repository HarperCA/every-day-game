// 后台界面：每个功能一个文件夹、三个函数各管一件事；浏览器那边拿不到服务器的代码；取数据 → 整理 → 呈现的每一步。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { importsOf, relTo, walk } from '../../../../共用/test/复用/扫描引用.mjs';
import { open, seed } from '../../../db/test/复用/样例数据.mjs';
import { 功能目录 } from '../../功能目录.mjs';
import { 目录清单 } from '../../目录清单.mjs';
import { 全部页, 找页 } from '../../框架/目录.mjs';
import { 处理后台请求 } from '../../接口.mjs';
import { 算扇环 } from '../../框架/组件/环形图.mjs';
import { 整理 as 整理总览 } from '../../功能/总览/整理.mjs';

const UI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const 服务器端 = f => f.endsWith(`${path.sep}数据库.mjs`) || ['接口.mjs', '服务.mjs', '建服务.mjs', '登录.mjs', '每日清理.mjs'].includes(path.basename(f)) && path.dirname(f) === UI_DIR;

describe('功能文件夹', () => {
  test('每个登记的功能都有 数据库.mjs、整理.mjs、呈现.mjs、index.mjs', () => {
    for (const [名, 目录] of Object.entries(功能目录)) {
      for (const f of ['数据库.mjs', '整理.mjs', '呈现.mjs', 'index.mjs']) expect(fs.existsSync(path.join(UI_DIR, 目录, f)), `${目录}/${f}`).toBe(true);
    }
  });
  test('每个功能正好出现一次（总览在比赛列表页的顶部）', () => {
    expect(全部页(目录清单).flatMap(页 => [...页.顶部, 页.功能].map(f => f.id)).sort()).toEqual(Object.keys(功能目录).sort());
  });
});

describe('目录：分类只是标题，子页面才能点；每个子页面单独一页（2026-11-01 用户定）', () => {
  test('分类和子页面的顺序', () => {
    expect(目录清单.map(c => [c.标题, c.页们.map(页 => 页.标题)])).toEqual([
      ['比赛管理', ['比赛列表', '回收站']],
      ['日志', ['失败任务', '操作记录', '访问异常']],
      ['自动化流程监测', ['抓取结果账', '接口用量', '屏蔽网站']],
      ['用户反馈', ['问卷统计', '意见反馈', '纠错审核']],
    ]);
  });
  test('比赛数据总览只在比赛列表页的顶部，回收站页没有；比赛列表页的说明是原来比赛管理的说明', () => {
    const [列表, 回收站] = 目录清单[0].页们;
    expect(列表.顶部.map(f => [f.id, f.标题])).toEqual([['总览', '比赛数据总览']]);
    expect(列表.功能.id).toBe('比赛管理');
    expect(列表.说明).toMatch(/回收站里保留 30 天/);
    expect(回收站.顶部).toEqual([]);
  });
  test('每页的地址就是它的标题，互不重复，能直接放在 # 后面', () => {
    const 地址们 = 全部页(目录清单).map(页 => 页.地址);
    expect(new Set(地址们).size).toBe(地址们.length);
    for (const 地址 of 地址们) expect(地址).toMatch(/^[^\s#/?&=]+$/);
  });
  test('按地址找页：认 #标题 和编码过的写法；没写或不认识的去比赛列表', () => {
    expect(找页(目录清单, '#回收站').标题).toBe('回收站');
    expect(找页(目录清单, '#' + encodeURIComponent('接口用量')).标题).toBe('接口用量');
    expect(找页(目录清单, '').标题).toBe('比赛列表');
    expect(找页(目录清单, '#不存在').标题).toBe('比赛列表');
    expect(找页(目录清单, '#%E0%A4%A').标题).toBe('比赛列表');
    expect(找页(目录清单, '#接口用量').分类.标题).toBe('自动化流程监测');
  });
});

describe('引用规矩', () => {
  const 文件 = walk(UI_DIR);
  test('浏览器那边的文件不引用 数据库.mjs、接口.mjs、服务.mjs，也不引用 后台/ 以外的文件', () => {
    const 越界 = 文件.filter(f => !服务器端(f)).flatMap(f => importsOf(f)
      .filter(t => 服务器端(t) || relTo(UI_DIR, t).startsWith('..'))
      .map(t => `${relTo(UI_DIR, f)} → ${relTo(UI_DIR, t)}`));
    expect(越界).toEqual([]);
  });
  test('数据库.mjs 只用比赛库的入口和同文件夹的文件', () => {
    const 越界 = 文件.filter(f => f.endsWith(`${path.sep}数据库.mjs`)).flatMap(f => importsOf(f)
      .filter(t => !(relTo(UI_DIR, t) === '../db/index.mjs' || path.dirname(t) === path.dirname(f)))
      .map(t => `${relTo(UI_DIR, f)} → ${relTo(UI_DIR, t)}`));
    expect(越界).toEqual([]);
  });
  test('整理.mjs 是纯计算：不引用任何文件，不碰页面和网络', () => {
    for (const f of 文件.filter(f => f.endsWith(`${path.sep}整理.mjs`))) {
      expect(importsOf(f), relTo(UI_DIR, f)).toEqual([]);
      expect(fs.readFileSync(f, 'utf8'), relTo(UI_DIR, f)).not.toMatch(/\bdocument\b|\bfetch\s*\(/);
    }
  });
  test('只有 框架/请求.mjs 发网络请求', () => {
    const 发请求 = 文件.filter(f => /\bfetch\s*\(/.test(fs.readFileSync(f, 'utf8'))).map(f => relTo(UI_DIR, f));
    expect(发请求).toEqual(['框架/请求.mjs']);
  });
});

describe('取数据 → 整理', () => {
  test('总览：比赛库还没数据时用 10-22 快照，标明示例；两种分法总数都是 343', async () => {
    const 原始 = await 处理后台请求('总览', {}, { db: open() });
    expect(原始.示例).toBe(true);
    expect(整理总览(原始, { 维度: '按状态' })).toMatchObject({ 总数: 343, 示例: true });
    expect(整理总览(原始, { 维度: '按级别' }).总数).toBe(343);
  });
  test('总览：比赛库有数据时按实际计数，级别没填的按比赛的算', async () => {
    const db = open(); seed(db);
    const 原始 = await 处理后台请求('总览', {}, { db });
    expect(原始.示例).toBe(false);
    const 按级别 = 整理总览(原始, { 维度: '按级别' });
    expect(按级别.总数).toBe(4);
    expect(Object.fromEntries(按级别.分组.map(g => [g.名称, g.数量]))).toEqual({ 国家级: 3, '省级/区域级': 1 });
    const 按状态 = 整理总览(原始, { 维度: '按状态' });
    expect(Object.fromEntries(按状态.分组.map(g => [g.名称, g.数量]))).toEqual({ 待人工审核: 3, 已发布: 1 });
  });
  test('总览、比赛管理都不算已删除的（只在回收站里）', async () => {
    const db = open(); seed(db);
    db.update('edition', 'ed-art-next', { deleted_at: '2026-10-30T00:00:00.000Z' }, 1);
    expect(整理总览(await 处理后台请求('总览', {}, { db }), { 维度: '按状态' }).总数).toBe(3);
    const 比赛们 = (await 处理后台请求('比赛管理', {}, { db })).比赛们;
    expect(比赛们.flatMap(c => c.届次们.map(e => e.id))).not.toContain('ed-art-next');
  });
  // 比赛管理的排版、筛选、新建、编辑、删除见 功能/比赛管理/test/
  test('没登记的功能名一律拒绝', async () => {
    await expect(处理后台请求('../../db/index', {}, {})).rejects.toMatchObject({ kind: '找不到' });
  });
});

describe('环形图计算', () => {
  test('各段首尾相接、合起来一整圈，占比之和为 1', () => {
    const 段 = 算扇环([{ 名称: 'a', 数量: 290 }, { 名称: 'b', 数量: 40 }, { 名称: 'c', 数量: 13 }], { 间隙度: 0 });
    expect(段[0].起).toBe(0);
    expect(段.at(-1).止).toBeCloseTo(360);
    expect(段.reduce((和, s) => 和 + s.占比, 0)).toBeCloseTo(1);
  });
  test('只有一类时画成整圈；全是 0 时不画', () => {
    expect(算扇环([{ 名称: 'a', 数量: 5 }])[0].d).toContain('A104 104 0 1 1');
    expect(算扇环([{ 名称: 'a', 数量: 0 }])).toEqual([]);
  });
});
