// 百度每天上限可以用环境变量 BAIDU_DAILY_LIMIT 改（2026-11-03，用户定新旧并行期间各用 15 次；名字和旧系统 search-engines.mjs 一样）。
// 不设、设了不是正整数：照旧 30。
import { describe, expect, test } from 'vitest';
import { 每天上限 } from '../../config.mjs';

describe('每天上限', () => {
  test('不设是 30；设了正整数就用它；乱写的不认', () => {
    expect(每天上限({})).toEqual({ baidu: 30 });
    expect(每天上限({ BAIDU_DAILY_LIMIT: '15' })).toEqual({ baidu: 15 });
    for (const 乱的 of ['0', '-3', 'abc', '1.5', '']) expect(每天上限({ BAIDU_DAILY_LIMIT: 乱的 })).toEqual({ baidu: 30 });
  });
});
