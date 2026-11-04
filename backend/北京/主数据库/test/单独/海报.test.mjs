// 北京主数据库的海报：美国推来的海报文件存在 海报/ 文件夹，文件名是内容哈希；首页卡片的 poster_url 指向它。
// 只收 640×360 的 JPG、60 KB 以内、文件名和内容哈希对得上的（传输出错、被改过的不收）。用临时文件夹跑。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { openMainDb, 同步, 海报 } from '../../index.mjs';
import { 假JPG } from '../../../../共用/test/复用/假图片.mjs';
import { 内容哈希 } from '../../../../共用/工具/图片.mjs';

const 目录们 = [];
const 新目录 = () => { const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), '北京海报-')); 目录们.push(目录); return 目录; };
afterEach(() => { for (const 目录 of 目录们.splice(0)) fs.rmSync(目录, { recursive: true, force: true }); });

const 图 = 假JPG(640, 360, 3000);
const 文件 = `${内容哈希(图)}.jpg`;
const 批次 = {
  比赛们: [{ id: 'event-math', version: 1, name: '数学建模', level: '国家级', data: {} }],
  届次们: [
    { id: 'ed-1', competition_id: 'event-math', version: 1, status: '已发布', data: { edition_name: '2026', poster: { file: 文件 } } },
    { id: 'ed-2', competition_id: 'event-math', version: 1, status: '已发布', data: { edition_name: '2027', poster: { file: `${'d'.repeat(64)}.jpg` } } },
    { id: 'ed-3', competition_id: 'event-math', version: 1, status: '已发布', data: { edition_name: '2028' } },
  ],
};

describe('收海报', () => {
  test('合规格、哈希对得上的存下；同一张再收不重复写', () => {
    const 目录 = 新目录();
    expect(海报.收(文件, 图, { 目录 })).toEqual({ 文件, 新存: true });
    expect(海报.收(文件, 图, { 目录 })).toEqual({ 文件, 新存: false });
    expect(海报.有(文件, { 目录 })).toBe(true);
    expect(fs.readdirSync(目录)).toEqual([文件]);
  });
  test('不收：文件名和内容对不上、不是 640×360、超过 60 KB、文件名不是 哈希.jpg', () => {
    const 目录 = 新目录();
    expect(() => 海报.收(`${'0'.repeat(64)}.jpg`, 图, { 目录 })).toThrow('对不上');
    const 大 = 假JPG(1280, 720);
    expect(() => 海报.收(`${内容哈希(大)}.jpg`, 大, { 目录 })).toThrow('640×360');
    const 超 = 假JPG(640, 360, 61 * 1024);
    expect(() => 海报.收(`${内容哈希(超)}.jpg`, 超, { 目录 })).toThrow('60 KB');
    expect(() => 海报.收('../x.jpg', 图, { 目录 })).toThrow('文件名');
    expect(fs.readdirSync(目录)).toEqual([]);
    expect(海报.有('../x.jpg', { 目录 })).toBe(false);
  });
  test('缺的：库里届次引用了、这边还没有文件的（美国据此补推）', () => {
    const 目录 = 新目录();
    const db = openMainDb({ file: ':memory:' });
    同步.收下(db, 批次);
    expect(海报.缺的(db, { 目录 }).sort()).toEqual([文件, `${'d'.repeat(64)}.jpg`].sort());
    海报.收(文件, 图, { 目录 });
    expect(海报.缺的(db, { 目录 })).toEqual([`${'d'.repeat(64)}.jpg`]);
  });
});

describe('同步时一起收海报', () => {
  test('批次里的 海报们（文件名 + base64）先存，再写库；结果里数一共新存了几张', () => {
    const 目录 = 新目录();
    const db = openMainDb({ file: ':memory:' });
    const 回 = 同步.收下(db, { ...批次, 海报们: [{ 文件, 内容: 图.toString('base64') }] }, { 海报目录: 目录 });
    expect(回).toMatchObject({ 新增: 4, 海报: 1 });
    expect(海报.有(文件, { 目录 })).toBe(true);
  });
  test('有一张海报不对，整批不收（库里什么都不写）', () => {
    const 目录 = 新目录();
    const db = openMainDb({ file: ':memory:' });
    expect(() => 同步.收下(db, { ...批次, 海报们: [{ 文件, 内容: 假JPG(1280, 720).toString('base64') }] }, { 海报目录: 目录 })).toThrow('对不上');
    expect(db.count('public_edition')).toBe(0);
  });
});
