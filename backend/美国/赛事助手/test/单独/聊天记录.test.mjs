// 聊天记录：给后台看的接口（2026-11-12 用户定）。按天归档（北京时间，新的日子在前），每天按人分组，
// 交回打码后的账号、用户输入的内容（带时间）和助手这一轮的回答（同日改：要看 AI 的回答），不交回完整 openid。只读，库文件不存在时当作没有记录。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { 打开问答记录 } from '../../问答记录.mjs';
import { 打开聊天记录, 打码账号, 聊天日期们, 某天聊天, 读账号备注, 默认备注文件 } from '../../聊天记录.mjs';

// Windows 上库文件开着删不掉：先关再删目录
const 临时 = [], 开着 = [];
const 临时文件 = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), '聊天-')); 临时.push(d); return path.join(d, '问答记录.db'); };
const 记住 = 库 => { if (库) 开着.push(库); return 库; };
afterEach(() => {
  vi.unstubAllEnvs();
  while (开着.length) 开着.pop().关闭();
  while (临时.length) fs.rmSync(临时.pop(), { recursive: true, force: true });
});

const 甲 = 'oAbCdE1234567890xyzWXYZ9876';
const 乙 = 'oZZZZZ0000000000000000001111';
// 和 assistantCore 存的一样：status、reply、replyViolations 都在；其他 用来造被拦下、出错的轮
const 轮 = (id, openid, createdAt, message, 其他 = {}) => ({ id, openid, sessionId: 's1', createdAt, status: 'answered', message, reply: `助手回答${id}`, replyViolations: [], modelCalls: [{ raw: '很长' }], ...其他 });

// 北京时间：11-12 全天是 UTC 11-11 16:00 到 11-12 16:00
function 写一些(file) {
  const 库 = 打开问答记录(file);
  for (const t of [
    轮('t1', 甲, '2026-11-11T16:05:00.000Z', '计算机有什么比赛'),        // 北京 11-12 00:05
    轮('t2', 乙, '2026-11-12T01:00:00.000Z', '数学建模什么时候报名'),    // 北京 11-12 09:00
    轮('t3', 甲, '2026-11-12T02:30:00.000Z', '要团队赛'),               // 北京 11-12 10:30
    轮('t4', 甲, '2026-11-11T15:59:00.000Z', '前一天晚上问的'),          // 北京 11-11 23:59
    轮('t5', 乙, '2026-11-01T03:00:00.000Z', '十一月一号'),              // 北京 11-01 11:00
  ]) 库.存(t);
  库.关闭();
}

describe('打码账号：前 6 位 + … + 后 4 位，分得清是不是同一个人，不露出完整标识', () => {
  test('正常长度的 openid', () => {
    expect(打码账号(甲)).toBe('oAbCdE…9876');
    expect(打码账号(乙)).toBe('oZZZZZ…1111');
  });
  test('短的也不整个露出来；空的写“未知”', () => {
    expect(打码账号('o1')).not.toBe('o1');
    expect(打码账号('abcdefgh')).not.toBe('abcdefgh');
    expect(打码账号('')).toBe('未知');
    expect(打码账号(null)).toBe('未知');
  });
});

describe('打开聊天记录：只读', () => {
  test('库文件不存在时交回 null，不建文件', () => {
    const file = 临时文件();
    expect(打开聊天记录(file)).toBeNull();
    expect(fs.existsSync(file)).toBe(false);
  });
  test('存在时能读，不能写', () => {
    const file = 临时文件();
    写一些(file);
    const 库 = 记住(打开聊天记录(file));
    expect(库).not.toBeNull();
    expect(() => 库.存(轮('t9', 甲, '2026-11-12T03:00:00.000Z', '写不进去'))).toThrow();
  });
  test('库文件不存在（记录库是 null）时两个接口都交回空的，不报错', () => {
    expect(聊天日期们(null)).toEqual({ 日期们: [], 总天数: 0, 页: 1, 每页: 30 });
    expect(某天聊天(null, '2026-11-12')).toEqual([]);
  });
});

describe('聊天日期们：按北京时间的日期归档，新的日子在前，能翻页', () => {
  test('每天几个人、几句；北京时间零点前后分到两天', () => {
    const file = 临时文件();
    写一些(file);
    const 库 = 记住(打开聊天记录(file));
    expect(聊天日期们(库)).toEqual({
      日期们: [
        { 日期: '2026-11-12', 人数: 2, 条数: 3 },
        { 日期: '2026-11-11', 人数: 1, 条数: 1 },
        { 日期: '2026-11-01', 人数: 1, 条数: 1 },
      ],
      总天数: 3, 页: 1, 每页: 30,
    });
  });
  test('翻页：每页几天，第几页', () => {
    const file = 临时文件();
    写一些(file);
    const 库 = 记住(打开聊天记录(file));
    expect(聊天日期们(库, { 页: 1, 每页: 2 })).toMatchObject({ 日期们: [{ 日期: '2026-11-12' }, { 日期: '2026-11-11' }], 总天数: 3, 页: 1, 每页: 2 });
    expect(聊天日期们(库, { 页: 2, 每页: 2 })).toMatchObject({ 日期们: [{ 日期: '2026-11-01' }], 总天数: 3, 页: 2 });
    // 乱写的页码、每页按 1 页、30 条算
    expect(聊天日期们(库, { 页: 'x', 每页: -5 })).toMatchObject({ 页: 1, 每页: 30 });
  });
  test('库是空的', () => {
    const file = 临时文件();
    打开问答记录(file).关闭();
    expect(聊天日期们(记住(打开聊天记录(file)))).toEqual({ 日期们: [], 总天数: 0, 页: 1, 每页: 30 });
  });
});

describe('某天聊天：这一天按人分组，账号、输入的内容和助手的回答', () => {
  test('每人一块：打码账号、几句、按时间先后列出每一句（北京时间）和这一句得到的回答；人按这一天第一次说话的先后', () => {
    const file = 临时文件();
    写一些(file);
    const 库 = 记住(打开聊天记录(file));
    expect(某天聊天(库, '2026-11-12')).toEqual([
      { 账号: 'oAbCdE…9876', 条数: 2, 输入们: [
        { 时间: '00:05', 内容: '计算机有什么比赛', 回答: '助手回答t1', 状态: '' },
        { 时间: '10:30', 内容: '要团队赛', 回答: '助手回答t3', 状态: '' },
      ] },
      { 账号: 'oZZZZZ…1111', 条数: 1, 输入们: [{ 时间: '09:00', 内容: '数学建模什么时候报名', 回答: '助手回答t2', 状态: '' }] },
    ]);
    expect(某天聊天(库, '2026-11-11')).toEqual([{ 账号: 'oAbCdE…9876', 条数: 1, 输入们: [{ 时间: '23:59', 内容: '前一天晚上问的', 回答: '助手回答t4', 状态: '' }] }]);
    expect(某天聊天(库, '2026-10-01')).toEqual([]);
  });
  test('回答和问题配对：同一个人连着问几句，每句下面是它自己那一轮的回答，不串', () => {
    const file = 临时文件();
    const 写 = 打开问答记录(file);
    // 故意乱序写进去、回答写得和问题对得上，看交回来是不是按时间排、仍然一一对应
    for (const [id, 时刻, 问] of [['c3', '03:00', '问三'], ['c1', '01:00', '问一'], ['c2', '02:00', '问二']]) {
      写.存(轮(id, 甲, `2026-11-12T${时刻}:00.000Z`, 问, { reply: `答${问.slice(1)}` }));
    }
    写.关闭();
    const 句们 = 某天聊天(记住(打开聊天记录(file)), '2026-11-12')[0].输入们;
    expect(句们.map(句 => [句.内容, 句.回答])).toEqual([['问一', '答一'], ['问二', '答二'], ['问三', '答三']]);
  });
  test('没有正常回答的：出错的回答是空的，带一句短的状态说明；被内容安全拦下的照实交回给用户的固定句子，也写明', () => {
    const file = 临时文件();
    const 写 = 打开问答记录(file);
    for (const t of [
      轮('b1', 甲, '2026-11-12T01:00:00.000Z', '违规的话', { status: 'blocked', reply: '这个问题我没法回答。' }),
      轮('b2', 甲, '2026-11-12T01:01:00.000Z', '超时那句', { status: 'assistant_timeout', reply: '' }),
      轮('b3', 甲, '2026-11-12T01:02:00.000Z', 'AI 出错那句', { status: 'assistant_ai_failed', reply: '' }),
      轮('b4', 甲, '2026-11-12T01:03:00.000Z', '检测出错那句', { status: 'assistant_check_failed', reply: '' }),
      轮('b5', 甲, '2026-11-12T01:04:00.000Z', '带网址那句', { status: 'answered', reply: '帮你查到了下面这些比赛：', replyViolations: ['url'] }),
      轮('b6', 甲, '2026-11-12T01:05:00.000Z', '没见过的状态', { status: '别的', reply: undefined }),
      轮('b7', 甲, '2026-11-12T01:06:00.000Z', '要澄清', { status: 'clarify', reply: '你是哪个专业？' }),
    ]) 写.存(t);
    写.关闭();
    const 句们 = 某天聊天(记住(打开聊天记录(file)), '2026-11-12')[0].输入们;
    expect(句们.map(句 => [句.内容, 句.回答, 句.状态])).toEqual([
      ['违规的话', '这个问题我没法回答。', '被内容安全拦下，回的是固定句子'],
      ['超时那句', '', '没有回答（超时）'],
      ['AI 出错那句', '', '没有回答（AI 出错）'],
      ['检测出错那句', '', '没有回答（内容安全检测出错）'],
      ['带网址那句', '帮你查到了下面这些比赛：', '原回答有网址或对不上的日期，换成了固定句子'],
      ['没见过的状态', '', '没有回答（出错）'],
      ['要澄清', '你是哪个专业？', ''],
    ]);
  });
  test('交回的数据里没有完整 openid，也不带模型原始输出等别的字段', () => {
    const file = 临时文件();
    写一些(file);
    const 文字 = JSON.stringify(某天聊天(记住(打开聊天记录(file)), '2026-11-12'));
    expect(文字).not.toContain(甲);
    expect(文字).not.toContain(乙);
    expect(文字).not.toContain('很长');
    expect(文字).not.toContain('s1');
  });
  test('日期要写成 YYYY-MM-DD，不是真日期的拒绝', () => {
    const file = 临时文件();
    写一些(file);
    const 库 = 记住(打开聊天记录(file));
    for (const 坏 of ['2026-11', '20261112', '2026-02-30', "2026-11-12' OR 1=1", undefined]) expect(() => 某天聊天(库, 坏)).toThrow(/日期/);
  });
});

// 账号备注（2026-11-12 用户定）：后台认得出某个账号是谁（比如用户本人），账号后面写“（备注）”。
// 备注放在一个 JSON 文件里 { "<完整 openid>": "备注" }，默认 DB_DIR/账号备注.json，ASSISTANT_ACCOUNT_NOTES_FILE 能改；不进代码、不进 git。
describe('账号备注：账号后面写“（备注）”，仍然不交完整 openid', () => {
  const 写备注 = (内容, 名 = '账号备注.json') => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), '备注-')); 临时.push(d);
    const file = path.join(d, 名);
    fs.writeFileSync(file, typeof 内容 === 'string' ? 内容 : JSON.stringify(内容));
    return file;
  };
  test('有备注的账号写成 打码账号（备注），没备注的不变；输出里没有完整 openid', () => {
    const file = 临时文件();
    写一些(file);
    const 备注 = 读账号备注(写备注({ [甲]: '管理员' }));
    const 人们 = 某天聊天(记住(打开聊天记录(file)), '2026-11-12', { 账号备注: 备注 });
    expect(人们.map(p => p.账号)).toEqual(['oAbCdE…9876（管理员）', 'oZZZZZ…1111']);
    const 文字 = JSON.stringify(人们);
    expect(文字).not.toContain(甲);
    expect(文字).not.toContain(乙);
  });
  test('也认普通对象；备注文件不存在、不是 JSON、不是对象时当没有备注，不报错', () => {
    const file = 临时文件();
    写一些(file);
    const 库 = 记住(打开聊天记录(file));
    expect(某天聊天(库, '2026-11-12', { 账号备注: { [甲]: '管理员' } })[0].账号).toBe('oAbCdE…9876（管理员）');
    for (const 备注 of [
      读账号备注(path.join(os.tmpdir(), '没有这个目录-备注', '账号备注.json')),
      读账号备注(写备注('{ 不是 json')),
      读账号备注(写备注('["管理员"]')),
      读账号备注(写备注('null')),
    ]) {
      expect(备注.size).toBe(0);
      expect(某天聊天(库, '2026-11-12', { 账号备注: 备注 }).map(p => p.账号)).toEqual(['oAbCdE…9876', 'oZZZZZ…1111']);
    }
  });
  test('不给备注时读默认文件：ASSISTANT_ACCOUNT_NOTES_FILE 优先，否则 DB_DIR/账号备注.json', () => {
    const file = 临时文件();
    写一些(file);
    const 库 = 记住(打开聊天记录(file));
    const 备注文件 = 写备注({ [甲]: '管理员' });
    vi.stubEnv('ASSISTANT_ACCOUNT_NOTES_FILE', '');
    vi.stubEnv('DB_DIR', path.dirname(备注文件));
    expect(默认备注文件()).toBe(path.join(path.dirname(备注文件), '账号备注.json'));
    expect(某天聊天(库, '2026-11-12')[0].账号).toBe('oAbCdE…9876（管理员）');
    vi.stubEnv('ASSISTANT_ACCOUNT_NOTES_FILE', 写备注({ [甲]: '本人' }, '别的名字.json'));
    expect(某天聊天(库, '2026-11-12')[0].账号).toBe('oAbCdE…9876（本人）');
    vi.stubEnv('ASSISTANT_ACCOUNT_NOTES_FILE', path.join(path.dirname(备注文件), '没有.json'));
    expect(某天聊天(库, '2026-11-12')[0].账号).toBe('oAbCdE…9876');
  });
  test('备注当文字：去掉换行、控制字符和 < > & 引号 反引号，最多 20 个字；空的、不是字符串的不要；备注里写了完整 openid 也打码', () => {
    const 备注 = 读账号备注(写备注({
      [甲]: " <b>管理\n员</b>&\"'`\u0007 ",
      [乙]: '一二三四五六七八九十一二三四五六七八九十多出来',
      o1111111111111111111111: '   ',
      o2222222222222222222222: 123,
      o3333333333333333333333: `就是 ${甲}`,
    }));
    expect(备注.get(甲)).toBe('b管理员/b');
    expect(备注.get(乙)).toBe('一二三四五六七八九十一二三四五六七八九十');
    expect(备注.has('o1111111111111111111111')).toBe(false);
    expect(备注.has('o2222222222222222222222')).toBe(false);
    expect(备注.get('o3333333333333333333333')).not.toContain(甲);
  });
});
