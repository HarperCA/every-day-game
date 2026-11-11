// 读网页换线路（2026-11-07 用户定，照旧系统）：美国连不上、超时、403 时改由北京服务器读；其余失败不换。用假的直读和假的 ssh。
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, test } from 'vitest';
import { 加北京线路, 北京客户端, 从环境造读网页 } from '../../北京读网页.mjs';

const 网址 = 'https://jw.beijing.gov.cn/notice.html';
const 直读结果 = 改 => ({ url: 网址, finalUrl: 网址, status: '超时', httpStatus: null, text: '', links: [], error: '超时', ...改 });
const 北京好 = 改 => ({ status: 'ok', url: 网址, finalUrl: `${网址}?x=1`, text: '通知正文'.repeat(100), links: [{ text: '报名', url: 'https://a.cn/s' }], format: 'html', via: 'beijing', ...改 });

function 工具(直读回, 北京回) {
  const 问过 = [];
  const 读 = 加北京线路(async () => 直读回, async (u, 选项) => { 问过.push({ u, 选项 }); if (北京回 instanceof Error) throw 北京回; return 北京回; });
  return { 读, 问过 };
}

describe('什么时候换线路', () => {
  test.each([
    ['超时', { status: '超时' }],
    ['网络错误', { status: '网络错误' }],
    ['403', { status: 'HTTP错误', httpStatus: 403 }],
  ])('美国%s：换北京，北京读到就用北京的，格式和 读网页 一样', async (_, 改) => {
    const { 读, 问过 } = 工具(直读结果(改), 北京好());
    const 回 = await 读(网址);
    expect(问过).toHaveLength(1);
    expect(回).toMatchObject({ url: 网址, finalUrl: `${网址}?x=1`, status: '成功', 线路: '北京', error: '' });
    expect(回.text).toContain('通知正文');
    expect(回.links).toEqual([{ url: 'https://a.cn/s', text: '报名', kind: '其他' }]);
  });
  test.each([
    ['成功', { status: '成功', text: '正文' }],
    ['正文太短', { status: '正文太短', text: '壳' }],
    ['404', { status: 'HTTP错误', httpStatus: 404 }],
    ['412 反爬', { status: 'HTTP错误', httpStatus: 412 }],
    ['robots 不允许', { status: 'robots不允许' }],
    ['网址不安全', { status: '网址不安全' }],
  ])('美国%s：不换，照旧交回', async (_, 改) => {
    const { 读, 问过 } = 工具(直读结果(改), 北京好());
    const 回 = await 读(网址);
    expect(问过).toEqual([]);
    expect(回.status).toBe(改.status);
  });
});

describe('北京的结果怎么换算', () => {
  test('北京说页面 404：不信，交回美国的结果（2026-11-07 实测 caa.org.cn 能打开，北京读网页程序却报 404，不能据此删比赛、换链接）', async () => {
    const { 读 } = 工具(直读结果(), 北京好({ status: 'http_404', text: '', links: [], error: '' }));
    const 结果 = await 读(网址);
    expect(结果.status).toBe('超时');
    expect(结果.error).toContain('北京');
  });
  test('北京说 robots 不允许：照规矩不读', async () => {
    const { 读 } = 工具(直读结果(), 北京好({ status: 'blocked', text: '', links: [] }));
    expect((await 读(网址)).status).toBe('robots不允许');
  });
  test('北京正文太短：标正文太短，文字留着', async () => {
    const { 读 } = 工具(直读结果(), 北京好({ status: 'too_short', text: '很短' }));
    expect(await 读(网址)).toMatchObject({ status: '正文太短', text: '很短', 线路: '北京' });
  });
  test.each([
    ['北京也超时', 北京好({ status: 'timeout', text: '', links: [], error: 'timeout' })],
    ['北京也连不上', 北京好({ status: 'network_error', text: '', links: [], error: 'x' })],
    ['北京返回 403', 北京好({ status: 'http_403', text: '', links: [] })],
    ['ssh 出错', new Error('beijing_reader_timeout')],
  ])('%s：交回美国的结果，原因里写明两边都试过', async (_, 回) => {
    const { 读 } = 工具(直读结果(), 回);
    const 结果 = await 读(网址);
    expect(结果.status).toBe('超时');
    expect(结果.error).toContain('北京');
  });
  test('选项原样传给直读，signal 也传给北京', async () => {
    const 直读选项 = [];
    const 问过 = [];
    const signal = new AbortController().signal;
    const 读 = 加北京线路(async (u, 选项) => { 直读选项.push(选项); return 直读结果(); }, async (u, 选项) => { 问过.push(选项); return 北京好(); });
    await 读(网址, { signal });
    expect(直读选项[0].signal).toBe(signal);
    expect(问过[0].signal).toBe(signal);
  });
});

// 假 ssh：收 stdin 里的 JSON，按设定回话
function 假ssh({ 输出 = JSON.stringify(北京好()), code = 0, 不退出 = false } = {}) {
  const 调用们 = [];
  const spawnImpl = (bin, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    const 调用 = { bin, args, 输入: '', killed: [] };
    调用们.push(调用);
    child.stdin.on('data', c => { 调用.输入 += c; });
    child.kill = sig => { 调用.killed.push(sig ?? 'SIGTERM'); setImmediate(() => child.emit('close', null, sig ?? 'SIGTERM')); };
    if (!不退出) setImmediate(() => { child.stdout.end(输出); child.stderr.end(''); setTimeout(() => child.emit('close', code, null), 2); });
    return child;
  };
  return { 调用们, spawnImpl };
}

describe('北京客户端（ssh 受限命令，只能读公开网页）', () => {
  const 造 = (f, 其余 = {}) => 北京客户端({ 主机: 'ubuntu@1.2.3.4', 密钥: '/k', spawnImpl: f.spawnImpl, ...其余 });
  test('严格校验主机、不交互，stdin 只传网址', async () => {
    const f = 假ssh();
    expect(await 造(f)(网址)).toMatchObject({ status: 'ok', via: 'beijing' });
    const { bin, args, 输入 } = f.调用们[0];
    expect(bin).toBe('ssh');
    for (const 项 of ['BatchMode=yes', 'StrictHostKeyChecking=yes', '/k', 'ubuntu@1.2.3.4']) expect(args).toContain(项);
    expect(JSON.parse(输入)).toEqual({ url: 网址 });
  });
  test('输出不是 JSON、格式不对、退出码不是 0：都抛错，不信', async () => {
    await expect(造(假ssh({ 输出: '不是 JSON' }))(网址)).rejects.toThrow('beijing_reader');
    await expect(造(假ssh({ 输出: JSON.stringify({ status: '乱写', text: '' }) }))(网址)).rejects.toThrow('beijing_reader');
    await expect(造(假ssh({ code: 255 }))(网址)).rejects.toThrow('beijing_reader');
  });
  test('超时：结束进程并抛错', async () => {
    const f = 假ssh({ 不退出: true });
    await expect(造(f, { 超时毫秒: 10 })(网址)).rejects.toThrow('beijing_reader_timeout');
    expect(f.调用们[0].killed.length).toBeGreaterThan(0);
  });
  test('输出太大：结束进程并抛错', async () => {
    await expect(造(假ssh({ 输出: 'x'.repeat(2000) }), { 最大字节: 100 })(网址)).rejects.toThrow('beijing_reader_output_limit');
  });
});

describe('从环境造读网页', () => {
  const 直读 = async () => 直读结果();
  test('没配 BEIJING_READER_HOST、KEY：就是直读，行为不变', () => {
    expect(从环境造读网页(直读, {})).toBe(直读);
    expect(从环境造读网页(直读, { BEIJING_READER_HOST: 'a' })).toBe(直读);
  });
  test('都配了：换成带线路的', () => {
    expect(从环境造读网页(直读, { BEIJING_READER_HOST: 'a', BEIJING_READER_KEY: '/k' })).not.toBe(直读);
  });
});
