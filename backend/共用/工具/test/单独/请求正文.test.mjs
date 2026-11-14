// 读请求正文（2026-11-03）：先把字节收齐再一次转成文字。原来各个小服务器逐块转文字再拼，一个汉字（UTF-8 三个字节）正好切在两块之间就成了乱码，
// 美国推公开比赛到北京时签名对不上（部署时实测：纯英文的海报请求都过了，带中文的比赛数据被拒）。上限按字节算。
import { describe, expect, test } from 'vitest';
import { 读正文, 读字节 } from '../../请求正文.mjs';

// 把一段文字的字节切成指定大小的块，模拟网络上一块块到
async function* 切块(文字, 块大小) {
  const 字节 = Buffer.from(文字, 'utf8');
  for (let i = 0; i < 字节.length; i += 块大小) yield 字节.subarray(i, i + 块大小);
}

describe('读正文', () => {
  test('汉字被切在两块之间也能原样拼回来', async () => {
    const 文字 = JSON.stringify({ 名称: '全国大学生数学建模竞赛'.repeat(50), 说明: '报名截止' });
    for (const 块大小 of [1, 2, 4, 7, 64]) expect(await 读正文(切块(文字, 块大小), 1024 * 1024)).toEqual({ 正文: 文字 });
  });
  test('超过上限（按字节）：交回 太大，不再往下读', async () => {
    expect(await 读正文(切块('汉'.repeat(10), 4), 29)).toEqual({ 太大: true });   // 30 个字节
    expect(await 读正文(切块('汉'.repeat(10), 4), 30)).toEqual({ 正文: '汉'.repeat(10) });
  });
  test('空的请求：空字符串', async () => {
    expect(await 读正文(切块('', 4), 10)).toEqual({ 正文: '' });
  });
});

// 读字节（2026-11-12）：北京上传头像要原样的二进制（multipart 里的图片），不能转成文字
describe('读字节', () => {
  async function* 块们(...bufs) { for (const b of bufs) yield b; }
  test('原样拼回字节，不转文字；超过上限交回 太大', async () => {
    const 图 = Buffer.from([0xff, 0xd8, 0x00, 0x80, 0xfe, 0x0d, 0x0a, 0xc3]);
    expect(await 读字节(块们(图.subarray(0, 3), 图.subarray(3)), 8)).toEqual({ 字节: 图 });
    expect(await 读字节(块们(图.subarray(0, 3), 图.subarray(3)), 7)).toEqual({ 太大: true });
    expect(await 读字节(块们(), 7)).toEqual({ 字节: Buffer.alloc(0) });
  });
});
