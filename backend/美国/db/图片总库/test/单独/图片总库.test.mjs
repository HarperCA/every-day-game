// 图片总库：海报和候选图的文件放在硬盘上，文件名是内容哈希；比赛库的届次里只记文件名。用临时文件夹跑。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { 图片总库 } from '../../../index.mjs';
import { 假JPG } from '../../../../../共用/test/复用/假图片.mjs';

const 目录们 = [];
const 新目录 = () => { const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), '图片总库-')); 目录们.push(目录); return { 目录 }; };
afterEach(() => { for (const 目录 of 目录们.splice(0)) fs.rmSync(目录, { recursive: true, force: true }); });

describe('存', () => {
  test('海报：640×360 的 JPG、60 KB 以内；文件名 = sha256 + .jpg；同一张存两次只有一个文件', () => {
    const 选项 = 新目录();
    const 图 = 假JPG(640, 360, 50 * 1024);
    const 回 = 图片总库.存(图, '海报', 选项);
    expect(回).toMatchObject({ 宽: 640, 高: 360, 字节: 50 * 1024, 是海报比例: true });
    expect(回.文件).toMatch(/^[0-9a-f]{64}\.jpg$/);
    expect(图片总库.存(图, '海报', 选项).文件).toBe(回.文件);
    expect(fs.readdirSync(选项.目录)).toEqual([回.文件]);
  });
  test('海报不合规格的拒收：不是 JPG、不是 640×360、超过 60 KB、读不出', () => {
    const 选项 = 新目录();
    expect(() => 图片总库.存(假JPG(1280, 720), '海报', 选项)).toThrow('640×360');
    expect(() => 图片总库.存(假JPG(640, 360, 61 * 1024), '海报', 选项)).toThrow('60 KB');
    expect(() => 图片总库.存(Buffer.alloc(100), '海报', 选项)).toThrow('读不出');
    expect(fs.readdirSync(选项.目录)).toEqual([]);
  });
  test('候选：任意比例、5 MB 以内；告诉调用方是不是 16:9', () => {
    const 选项 = 新目录();
    expect(图片总库.存(假JPG(1200, 800), '候选', 选项)).toMatchObject({ 宽: 1200, 高: 800, 是海报比例: false });
    expect(() => 图片总库.存(假JPG(1200, 800, 5 * 1024 * 1024 + 1), '候选', 选项)).toThrow('5 MB');
    expect(() => 图片总库.存(假JPG(640, 360), '别的', 选项)).toThrow('种类');
  });
});

describe('读和查', () => {
  test('按文件名读回内容和格式；有没有；文件名格式不对的一律拒绝（不能读到别的路径）', () => {
    const 选项 = 新目录();
    const { 文件 } = 图片总库.存(假JPG(640, 360), '海报', 选项);
    expect(图片总库.读(文件, 选项)).toMatchObject({ 格式: 'jpg' });
    expect(图片总库.读(文件, 选项).内容.length).toBe(1000);
    expect(图片总库.有(文件, 选项)).toBe(true);
    expect(图片总库.有(`${'0'.repeat(64)}.jpg`, 选项)).toBe(false);
    expect(() => 图片总库.读('../比赛库.db', 选项)).toThrow('文件名');
    expect(图片总库.有('../比赛库.db', 选项)).toBe(false);
    expect(() => 图片总库.读(`${'0'.repeat(64)}.jpg`, 选项)).toThrow('没有这张图');
  });
});
