// 图片工具：只读文件头拿格式和宽高（不解码整张图），判断是不是 16:9 海报。美国图片总库和北京收海报都用这一份。
import { describe, expect, test } from 'vitest';
import { 图片大小, 是海报比例, 海报规格, 内容哈希 } from '../../图片.mjs';
import { 假JPG, 假PNG, 假WebP } from '../../../test/复用/假图片.mjs';


describe('图片大小', () => {
  test('JPG、PNG、WebP 读出格式和宽高；读不出的给 null', () => {
    expect(图片大小(假JPG(640, 360))).toEqual({ 格式: 'jpg', 宽: 640, 高: 360 });
    expect(图片大小(假PNG(1920, 1080))).toEqual({ 格式: 'png', 宽: 1920, 高: 1080 });
    expect(图片大小(假WebP(1200, 800))).toEqual({ 格式: 'webp', 宽: 1200, 高: 800 });
    expect(图片大小(Buffer.from('不是图片也不够长的内容但是超过二十四个字节了吧'))).toBeNull();
    expect(图片大小(Buffer.alloc(3))).toBeNull();
  });
});

describe('海报规则（2026-10-24 用户定）', () => {
  test('16:9：宽高比 1.76～1.79 才算', () => {
    expect(是海报比例(1920, 1080)).toBe(true);
    expect(是海报比例(1760, 1000)).toBe(true);
    expect(是海报比例(1200, 800)).toBe(false);
    expect(是海报比例(0, 0)).toBe(false);
  });
  test('海报 640×360 的 JPG、60 KB 以内；候选 5 MB 以内、最多 10 张', () => {
    expect(海报规格).toEqual({ 宽: 640, 高: 360, 最大字节: 60 * 1024, 候选最大字节: 5 * 1024 * 1024, 最多候选: 10 });
  });
  test('内容哈希是 sha256 的十六进制', () => {
    expect(内容哈希(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
