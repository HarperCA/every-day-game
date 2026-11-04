// 统一错误类型：按状态码归类、哪些能重试。
import { describe, expect, test } from 'vitest';
import { AiError, kindFromStatus } from '../../errors.mjs';

describe('错误类型', () => {
  test('按状态码归类，哪些能重试', () => {
    expect(kindFromStatus(429)).toBe('请求太多');
    expect(kindFromStatus(401)).toBe('密钥错误');
    expect(kindFromStatus(502)).toBe('对方出错');
    expect(kindFromStatus(400)).toBe('请求有误');
    expect(new AiError('请求太多', 'x').retryable).toBe(true);
    expect(new AiError('额度用完', 'x').retryable).toBe(false);
    expect(new AiError('密钥错误', 'x').retryable).toBe(false);
    expect(() => new AiError('乱写的', 'x')).toThrow('未知');
  });
});
