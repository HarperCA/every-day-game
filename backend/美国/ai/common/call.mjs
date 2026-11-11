// 分发和调用流程（所有接口、所有能力共用，只写一份）：
//
//   按用途查配置：用哪种能力（对话、搜索、读网页、判断）、发给哪家（可以是依次补位的几家）、用哪个模型
//   → 对每一家：进“车道 + 接口”的并发池排队
//     → 每次尝试前：这家是不是在暂停中；今天的次数用完没有（手动测试不算）；取密钥
//     → 交给这家接口的对应能力（带停止信号）→ 把报错归到统一类型
//     → 不管成败，当场记账（每次尝试一行）
//     → 能重试的等一会儿再试（等待时间翻倍）；同一家连续失败太多次就暂停一段时间；密钥错误直接暂停
//   → 这一家最后还是失败，而且后面还有补位的，换下一家；都失败才报错
//   → 对话要 JSON 时解析，解析不出来再整次调用一遍（最多 jsonRetry 次）→ 交回
//
// 带工具的多轮对话（赛事助手、追溯）：每一轮都是一次 call，每轮各记一次账；轮数上限由调用方管。
import { createPool } from '../../../共用/工具/concurrency.mjs';
import { AiError, toAiError } from './errors.mjs';

export const CAPABILITIES = ['chat', 'search', 'fetchPage', 'decide'];

const wait = (ms, signal) => new Promise((resolve, reject) => {
  if (ms <= 0) return resolve();
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason || new Error('aborted')); }, { once: true });
});

// 模型常把 JSON 包在 ```json 代码块里，先剥掉再解析；解析不出来返回 undefined
export function parseJson(text) {
  if (typeof text !== 'string') return undefined;
  const body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(body); } catch { return undefined; }
}

function costOf(prices, provider, model, tokensIn, tokensOut) {
  const price = prices[model] || prices[provider];
  if (!price || tokensIn == null || tokensOut == null) return null;
  return Math.round(((tokensIn * price.input + tokensOut * price.output) / 1e6) * 1e6) / 1e6;
}

const chainOf = cfg => (Array.isArray(cfg.provider) ? cfg.provider : [cfg.provider]);

export function createCaller({ config, providers, keys, usage, now = () => Date.now(), sleep = wait }) {
  const pools = new Map();
  const health = new Map();   // 接口名 → { fails, pausedUntil }

  const poolFor = (lane, provider) => {
    const key = `${lane}:${provider}`;
    if (!pools.has(key)) pools.set(key, createPool({ limit: config.lanes[lane]?.concurrency || 1 }));
    return pools.get(key);
  };
  const stateOf = provider => {
    if (!health.has(provider)) health.set(provider, { fails: 0, pausedUntil: 0 });
    return health.get(provider);
  };

  // 今天还能不能用这家（手动测试不受限、也不占份额）
  function checkDailyLimit(name, identity) {
    const limit = config.dailyLimits?.[name];
    if (limit == null || identity.source === config.manualSource) return;
    const used = usage.countToday(name, { excludeSource: config.manualSource });
    if (used >= limit) throw new AiError('额度用完', `${name} 今天的自动调用已用 ${used}/${limit} 次，剩下的留给手动测试`, { provider: name });
  }

  // 对一家接口做一次完整的尝试（含重试），成功交回结果，失败抛统一类型的错
  async function attempt({ name, provider, capability, cfg, request, promptVersion, identity, signal }) {
    const state = stateOf(name);
    // 补位的几家各用各的模型（models 按接口名写）；只有一家时用 model
    const model = cfg.models ? (cfg.models[name] ?? null) : cfg.model;
    for (let n = 1; ; n += 1) {
      const started = now();
      const base = { identity, purpose: identity.purpose, provider: name, model, promptVersion, attempt: n };
      try {
        if (state.pausedUntil > started) {
          throw new AiError('已暂停', `${name} 暂停中，${Math.ceil((state.pausedUntil - started) / 1000)} 秒后恢复`, { provider: name });
        }
        checkDailyLimit(name, identity);
        const key = provider.needsKey === false ? null : keys.get(name);
        const res = await provider[capability]({ ...request, model, effort: cfg.effort, codexSearch: cfg.codexSearch, codexSearchLimit: cfg.codexSearchLimit,
          thinking: cfg.thinking, temperature: cfg.temperature, maxTokens: cfg.maxTokens,
          ...(cfg.searchApi ? { searchApi: cfg.searchApi, count: cfg.count } : {}), key, signal });
        const ms = now() - started;
        const cost = costOf(config.prices, name, model, res.tokensIn, res.tokensOut);
        usage.recordCall({ ...base, tokensIn: res.tokensIn ?? null, tokensOut: res.tokensOut ?? null, cost, ms, ok: true });
        state.fails = 0;
        return { res, usage: { tokensIn: res.tokensIn ?? null, tokensOut: res.tokensOut ?? null, cost, ms, attempts: n } };
      } catch (raw) {
        const error = raw instanceof AiError ? raw : (provider.classifyError?.(raw) || toAiError(raw, name));
        error.message = keys.mask(error.message);
        usage.recordCall({ ...base, ms: now() - started, ok: false, errorKind: error.kind, error: error.message });
        if (!['已暂停', '额度用完', '搜索超限'].includes(error.kind)) {
          state.fails += 1;
          if (error.kind === '密钥错误' || state.fails >= config.breaker.failures) {
            state.pausedUntil = now() + config.breaker.pauseMs;
            state.fails = 0;
          }
        }
        if (!error.retryable || n >= config.retry.attempts) throw error;
        await sleep(config.retry.backoffMs * 2 ** (n - 1), signal);
      }
    }
  }

  return async function call({ purpose, capability, request = {}, json = false, promptVersion = null, identity = {}, lane = 'batch', signal } = {}) {
    const cfg = config.purposes[purpose];
    if (!cfg) throw new AiError('请求有误', `没有叫 ${purpose} 的用途`);
    if (capability && cfg.能力 !== capability) throw new AiError('请求有误', `用途 ${purpose} 的能力是 ${cfg.能力}，不能当 ${capability} 用`);
    if (!CAPABILITIES.includes(cfg.能力)) throw new AiError('请求有误', `用途 ${purpose} 的能力 ${cfg.能力} 不认识`);
    const chain = chainOf(cfg);
    if (!chain[0]) throw new AiError('请求有误', `用途 ${purpose} 还没指定用哪家接口`);
    for (const name of chain) {
      if (typeof providers[name]?.[cfg.能力] !== 'function') throw new AiError('请求有误', `用途 ${purpose} 指向的 ${name} 没有 ${cfg.能力} 能力`);
    }
    if (!config.lanes[lane]) throw new AiError('请求有误', `没有叫 ${lane} 的车道`);
    const who = { ...identity, purpose };

    let total = { tokensIn: 0, tokensOut: 0, cost: 0, ms: 0, attempts: 0 };
    const add = u => {
      total = { tokensIn: total.tokensIn + (u.tokensIn || 0), tokensOut: total.tokensOut + (u.tokensOut || 0),
        cost: u.cost == null ? total.cost : total.cost + u.cost, ms: total.ms + u.ms, attempts: total.attempts + u.attempts };
    };
    const tried = [];
    for (let i = 0; i < chain.length; i += 1) {
      const name = chain[i];
      const args = { name, provider: providers[name], capability: cfg.能力, cfg, request, promptVersion, identity: who, signal };
      try {
        for (let jsonTry = 0; ; jsonTry += 1) {
          const result = await poolFor(lane, name).run(() => attempt(args));
          add(result.usage);
          if (cfg.能力 !== 'chat' || !json) return { ...result.res, data: null, provider: name, tried, usage: total };
          const data = parseJson(result.res.message?.content);
          if (data !== undefined) return { ...result.res, data, provider: name, tried, usage: total };
          if (jsonTry >= config.jsonRetry) throw new AiError('格式不对', `用途 ${purpose} 要求返回 JSON，试了 ${jsonTry + 1} 次都解析不出来`, { provider: name });
        }
      } catch (error) {
        if (signal?.aborted || i === chain.length - 1) throw error;
        tried.push({ provider: name, kind: error.kind, message: error.message });   // 换下一家补位
      }
    }
    throw new AiError('请求有误', `用途 ${purpose} 没有可用的接口`);
  };
}
