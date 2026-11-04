// 令牌：北京登录时签发，美国收到请求时校验（2026-11-01 用户定）。两边用同一个密钥，这里只测签发和校验本身。
import crypto from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { 签发令牌, 校验令牌, 有效秒数 } from '../../令牌.mjs';

const 密钥 = 'k'.repeat(32);
const 另一个密钥 = 'z'.repeat(32);
const T0 = Date.parse('2026-11-01T08:00:00Z');

describe('令牌', () => {
  test('签发后校验通过，交回 openid；默认 2 小时有效', () => {
    const 令牌 = 签发令牌('o-123', 密钥, { now: T0 });
    expect(有效秒数).toBe(7200);
    expect(校验令牌(令牌, 密钥, { now: T0 })).toEqual({ ok: true, openid: 'o-123', 过期: T0 + 7200 * 1000 });
    expect(校验令牌(令牌, 密钥, { now: T0 + 7199 * 1000 }).ok).toBe(true);
  });
  test('到期就不认，原因是“已过期”', () => {
    const 令牌 = 签发令牌('o-123', 密钥, { now: T0, 有效秒: 60 });
    expect(校验令牌(令牌, 密钥, { now: T0 + 60 * 1000 })).toEqual({ ok: false, 原因: '已过期' });
  });
  test('换了密钥、改了内容、改了签名：都是“签名不对”', () => {
    const 令牌 = 签发令牌('o-123', 密钥, { now: T0 });
    const [内容, 签名] = 令牌.split('.');
    const 假内容 = Buffer.from(JSON.stringify({ openid: 'o-别人', exp: 9999999999 })).toString('base64url');
    expect(校验令牌(令牌, 另一个密钥, { now: T0 })).toEqual({ ok: false, 原因: '签名不对' });
    expect(校验令牌(`${假内容}.${签名}`, 密钥, { now: T0 })).toEqual({ ok: false, 原因: '签名不对' });
    expect(校验令牌(`${内容}.${签名.slice(0, -2)}AA`, 密钥, { now: T0 })).toEqual({ ok: false, 原因: '签名不对' });
  });
  test('没带令牌是“缺令牌”；形状不对是“格式不对”', () => {
    expect(校验令牌('', 密钥)).toEqual({ ok: false, 原因: '缺令牌' });
    expect(校验令牌(undefined, 密钥)).toEqual({ ok: false, 原因: '缺令牌' });
    for (const 坏 of ['abc', 'a.b.c', '.', '内容.签名']) expect(校验令牌(坏, 密钥)).toEqual({ ok: false, 原因: '格式不对' });
  });
  test('签名对但内容缺 openid 或过期时间，也不认', () => {
    const 自己签 = 内容 => { const b = Buffer.from(JSON.stringify(内容)).toString('base64url'); return `${b}.${crypto.createHmac('sha256', 密钥).update(b).digest('base64url')}`; };
    expect(校验令牌(自己签({ exp: 9999999999 }), 密钥, { now: T0 })).toEqual({ ok: false, 原因: '格式不对' });
    expect(校验令牌(自己签({ openid: 'o' }), 密钥, { now: T0 })).toEqual({ ok: false, 原因: '格式不对' });
  });
  test('密钥没配或太短（少于 32 个字符）直接报错，不签也不验；openid 为空不签', () => {
    expect(() => 签发令牌('o', 'short')).toThrow(/密钥/);
    expect(() => 校验令牌('a.b', '')).toThrow(/密钥/);
    expect(() => 签发令牌('', 密钥)).toThrow(/openid/);
  });
});
