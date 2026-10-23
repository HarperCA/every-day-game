import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { validateAskInput, MAX_MESSAGE_CHARS } = require('../apps/miniprogram/cloudfunctions/assistant/askValidation.js');

describe('赛事助手：输入校验', () => {
  it('空的或全是空格的提问直接拒绝', () => {
    expect(() => validateAskInput({ message:'' })).toThrow('assistant_input_invalid');
    expect(() => validateAskInput({ message:'   ' })).toThrow('assistant_input_invalid');
    expect(() => validateAskInput({ message:123 })).toThrow('assistant_input_invalid');
  });

  it('按“字”数限制长度，表情符号算一个字', () => {
    expect(validateAskInput({ message:'字'.repeat(MAX_MESSAGE_CHARS) }).message).toHaveLength(MAX_MESSAGE_CHARS);
    expect(() => validateAskInput({ message:'字'.repeat(MAX_MESSAGE_CHARS + 1) })).toThrow('assistant_input_invalid');
    expect(validateAskInput({ message:'😀'.repeat(MAX_MESSAGE_CHARS) }).message).toBeTruthy();
  });

  it('去掉首尾空白', () => {
    expect(validateAskInput({ message:'  找比赛  ' }).message).toBe('找比赛');
  });

  it('sessionId 格式不对就当作新会话', () => {
    expect(validateAskInput({ message:'a', sessionId:'session-' + 'a'.repeat(24) }).sessionId).toBe('session-' + 'a'.repeat(24));
    expect(validateAskInput({ message:'a', sessionId:'session-xyz' }).sessionId).toBe('');
    expect(validateAskInput({ message:'a', sessionId:{ $ne:'' } }).sessionId).toBe('');
  });

  it('专业偏好只保留十三类里的，并去重', () => {
    const input = validateAskInput({ message:'a', profileCategories:['计算机与AI', '随便写的', '计算机与AI', 1] });
    expect(input.profileCategories).toEqual(['计算机与AI']);
    expect(validateAskInput({ message:'a', profileCategories:'计算机与AI' }).profileCategories).toEqual([]);
  });
});
