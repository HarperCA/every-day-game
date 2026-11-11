// 测试用：假的接口和组装好的 AI 总管。不连任何真实接口、不花钱，用量库放在内存里。
import { createAi } from '../../index.mjs';
import { DEFAULT_CONFIG } from '../../common/config.mjs';
import { createKeyStore } from '../../common/keys.mjs';
import { createUsageStore } from '../../common/usage.mjs';

// 按事先排好的结果依次作答；是 Error 就抛出；排到最后一个后一直用最后一个
const next = script => (script.length > 1 ? script.shift() : script[0]);

// 假的对话接口：script 里是回答的文字
export function fakeProvider(name, script) {
  const calls = [];
  return { calls, provider: { name, async chat(args) {
    calls.push(args);
    const item = next(script);
    if (item instanceof Error) throw item;
    return { message: { role: 'assistant', content: item }, tokensIn: 100, tokensOut: 20 };
  } } };
}

// 假的搜索接口：script 里是每次交回的网址列表
export function fakeSearcher(name, script) {
  const calls = [];
  return { calls, provider: { name, async search(args) {
    calls.push(args);
    const item = next(script);
    if (item instanceof Error) throw item;
    return { references: item.map(url => ({ title: url, url, content: '', date: '' })) };
  } } };
}

const KEYS = { AI_KEY_DEEPSEEK: 'sk-test-0000000000', AI_KEY_CODEX: 'cx-test-0000000000', AI_KEY_KIMI: 'km-test-0000000000', AI_KEY_BAIDU: 'bd-test-0000000000', AI_KEY_JEV: 'jv-test-0000000000' };

// 组装一个用假接口的 AI 总管；重试不等待。extraProviders 可以补上别的假接口（搜索等）
export function setup({ deepseek = ['好'], codex = ['好'], config = {}, extraProviders = {} } = {}) {
  const ds = fakeProvider('deepseek', deepseek);
  const cx = fakeProvider('codex', codex);
  const usage = createUsageStore(':memory:');
  const cfg = { ...DEFAULT_CONFIG, retry: { attempts: 3, backoffMs: 0 }, ...config };
  const ai = createAi({ config: cfg, providers: { deepseek: ds.provider, codex: cx.provider, ...extraProviders }, usage, keys: createKeyStore({ env: KEYS }) });
  return { ai, usage, ds, cx };
}

// 每晚流程里一个模块的会话身份
export const night = { source: '每晚自动化', runId: '2026-10-29', module: '04-extract' };
