// 新维护接北京代读（2026-11-09）：环境里有 BEIJING_FETCH_ENDPOINT 和同步秘钥（SYNC_SECRET 或 SYNC_SECRET_FILE）时，
// 读网页、取源码用 带北京兜底 包起来；没有就照旧。浏览器不经北京。
import { describe, expect, test } from 'vitest';
import { 接北京兜底 } from '../../运行.mjs';

const 读网页 = async () => ({ status: '超时', error: '超过 20 秒没下载完' });
const 取源码 = async () => ({ status: '成功', html: '<html></html>' });

function 假部件() {
  const 收到 = [];
  return {
    收到,
    带北京兜底: ({ 读网页: 读, 取源码: 取, 代读 }) => ({ 读网页: async (网址, 选项) => { 收到.push(await 读(网址, 选项)); return 代读(网址, { 方式: '网页' }); }, 取源码: 取 }),
    代读: async (网址, 选项) => ({ status: '成功', 经北京: true, 网址, 选项 }),
  };
}

describe('接北京兜底', () => {
  test('没配地址或秘钥：照旧，原样交回', () => {
    const 部件 = 假部件();
    for (const env of [{}, { BEIJING_FETCH_ENDPOINT: 'https://bj/sync/fetch' }, { SYNC_SECRET: 's'.repeat(40) }]) {
      const 工具 = 接北京兜底({ 读网页, 取源码 }, { ...部件, env });
      expect(工具.读网页).toBe(读网页);
      expect(工具.取源码).toBe(取源码);
    }
  });
  test('配了地址和 SYNC_SECRET：包上兜底，代读带上地址和秘钥', async () => {
    const 部件 = 假部件();
    const 工具 = 接北京兜底({ 读网页, 取源码 }, { ...部件, env: { BEIJING_FETCH_ENDPOINT: 'https://bj/sync/fetch', SYNC_SECRET: 's'.repeat(40) } });
    expect(工具.读网页).not.toBe(读网页);
    const r = await 工具.读网页('https://a.cn/n');
    expect(r).toMatchObject({ 经北京: true, 网址: 'https://a.cn/n', 选项: { 方式: '网页', endpoint: 'https://bj/sync/fetch', 秘钥: 's'.repeat(40) } });
    expect(部件.收到[0].status).toBe('超时');
  });
  test('秘钥从 SYNC_SECRET_FILE 读（去掉首尾空白）', async () => {
    const 部件 = 假部件();
    const 读过 = [];
    const 工具 = 接北京兜底({ 读网页, 取源码 }, { ...部件, env: { BEIJING_FETCH_ENDPOINT: 'https://bj/sync/fetch', SYNC_SECRET_FILE: '/secrets/sync' }, 读文件: f => { 读过.push(f); return `${'f'.repeat(40)}\n`; } });
    expect((await 工具.读网页('https://a.cn/n')).选项.秘钥).toBe('f'.repeat(40));
    expect(读过).toEqual(['/secrets/sync']);
  });
});
