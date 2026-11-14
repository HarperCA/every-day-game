// 海报导入：届次对得上的设海报，已有海报的不覆盖，重跑不重复。用内存库和临时目录，不碰线上。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDb } from '../../../db/index.mjs';
import { 写海报 } from '../../海报.mjs';

// 最小 JPG 头：SOF0 段写明宽高，尾部补字节让每张内容不同
function 假图(宽, 高, 记号) {
  const 头 = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 高 >> 8, 高 & 255, 宽 >> 8, 宽 & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([头, Buffer.from(`-${记号}-`.padEnd(40, 'x'))]);
}

let 目录, db;
const 图们 = { 'a.jpg': 假图(640, 360, 'a'), 'b.jpg': 假图(640, 360, 'b'), 'c.jpg': 假图(1920, 1080, 'c') };
const 读文件 = 名 => 图们[名];
const 项 = (id, action, target, file) => ({ id, action, target, file, page_url: `https://x.cn/${id}` });
const at = '2026-11-04T16:00:00.000Z';

beforeEach(() => {
  目录 = fs.mkdtempSync(path.join(os.tmpdir(), '海报导入-'));
  db = openDb({ file: ':memory:' });
  db.insert('competition', 'event-1', { name: '甲杯', level: '国家级' });
  db.insert('edition', 'ed-1', { competition_id: 'event-1', ordinal: 1, edition_name: '甲杯第一届', status: '已归档' });
  db.insert('edition', 'ed-2', { competition_id: 'event-1', ordinal: 2, edition_name: '甲杯第二届', status: '待人工审核', status_reason: ['等人定'] });
});
afterEach(() => { db.close(); fs.rmSync(目录, { recursive: true, force: true }); });

describe('写海报', () => {
  test('海报写进图片总库和届次，候选进候选列表，状态不变', () => {
    expect(写海报(db, [项('p1', '海报', 'ed-1', 'a.jpg'), 项('p2', '候选', 'ed-2', 'c.jpg')], { 目录, 读文件, at })).toEqual({ 海报: 1, 候选: 1, 跳过: [] });
    const 一 = db.get('edition', 'ed-1').data;
    expect(一.poster).toMatchObject({ source: 'official', sourceUrl: 'https://x.cn/p1', updatedAt: at });
    expect(fs.existsSync(path.join(目录, 一.poster.file))).toBe(true);
    expect(一.status).toBe('已归档');
    const 二 = db.get('edition', 'ed-2').data;
    expect(二.poster ?? null).toBeNull();
    expect(二.poster_candidates[0]).toMatchObject({ width: 1920, height: 1080, source: 'official' });
    expect(二.status).toBe('待人工审核');
  });
  test('已有海报的不覆盖，新图转成候选', () => {
    写海报(db, [项('p1', '海报', 'ed-1', 'a.jpg')], { 目录, 读文件, at });
    const 原来 = db.get('edition', 'ed-1').data.poster.file;
    expect(写海报(db, [项('p2', '海报', 'ed-1', 'b.jpg')], { 目录, 读文件, at })).toEqual({ 海报: 0, 候选: 1, 跳过: [] });
    expect(db.get('edition', 'ed-1').data.poster.file).toBe(原来);
    expect(db.get('edition', 'ed-1').data.poster_candidates).toHaveLength(1);
  });
  test('不合规格的海报拒收，库不变', () => {
    expect(() => 写海报(db, [项('p1', '海报', 'ed-1', 'c.jpg')], { 目录, 读文件, at })).toThrow('640');
    expect(db.get('edition', 'ed-1').data.poster ?? null).toBeNull();
  });
  test('没有的届次写明跳过；试跑不写文件也不改库', () => {
    expect(写海报(db, [项('p1', '海报', 'ed-x', 'a.jpg'), 项('p2', '海报', 'ed-1', 'a.jpg')], { 目录, 读文件, at, 试跑: true })).toEqual({ 海报: 1, 候选: 0, 跳过: [{ id: 'p1', 原因: '没有届次 ed-x' }] });
    expect(fs.readdirSync(目录)).toEqual([]);
    expect(db.get('edition', 'ed-1').data.poster ?? null).toBeNull();
  });
});
