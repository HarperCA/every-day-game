// 并发池：模块内部同时发多个请求加快速度，但要守住三条——
//   1. 同时最多 limit 个请求在跑，其余排队；
//   2. 两次请求之间至少隔 minGapMs；同一个网站（hostOf 算出的键）之间至少隔 perHostGapMs；
//   3. 失败按 retries 重试，每次等待时间翻倍（遇到 429 之类的“请求太多”尤其需要）。
// 停止信号 signal 一旦触发，还没开始的任务直接记为取消，已经在跑的由任务自己响应。
//
// 用法：
//   const pool = createPool({ limit: 8, retries: 2 });
//   const results = await pool.map(items, item => callApi(item));
//   // results[i] 是 { ok: true, value } 或 { ok: false, error }，一条失败不影响其他条

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (ms <= 0) return resolve();
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason || new Error('aborted')); }, { once: true });
});

export function createPool({ limit = 4, minGapMs = 0, perHostGapMs = 0, retries = 0, retryDelayMs = 500,
  shouldRetry = () => true, signal } = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('并发数 limit 必须是正整数');
  let active = 0;
  let lastStart = 0;
  const lastByHost = new Map();
  const queue = [];

  // 等到可以开始的时刻：按真正开始的时间记账。醒来后再核对一次，
  // 因为可能有别的任务同时醒来并抢先开始了（检查和记账之间没有 await，不会被插队）
  async function waitTurn(host) {
    for (;;) {
      const now = Date.now();
      let ready = lastStart + minGapMs;
      if (host && perHostGapMs) ready = Math.max(ready, (lastByHost.get(host) ?? -Infinity) + perHostGapMs);
      if (now >= ready) {
        lastStart = now;
        if (host) lastByHost.set(host, now);
        return;
      }
      await sleep(ready - now, signal);
    }
  }

  async function attempt(task, host) {
    let error;
    for (let n = 0; n <= retries; n += 1) {
      if (signal?.aborted) throw signal.reason || new Error('aborted');
      await waitTurn(host);
      try {
        return await task(n);
      } catch (err) {
        error = err;
        if (n === retries || !shouldRetry(err)) break;
        await sleep(retryDelayMs * 2 ** n, signal);
      }
    }
    throw error;
  }

  function pump() {
    while (active < limit && queue.length) {
      const job = queue.shift();
      active += 1;
      attempt(job.task, job.host).then(job.resolve, job.reject).finally(() => { active -= 1; pump(); });
    }
  }

  function run(task, { host } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason || new Error('aborted'));
      queue.push({ task, host, resolve, reject });
      pump();
    });
  }

  async function map(items, fn, { hostOf } = {}) {
    return Promise.all(items.map((item, index) => run(n => fn(item, index, n), { host: hostOf?.(item) })
      .then(value => ({ ok: true, value }), error => ({ ok: false, error }))));
  }

  return { run, map, get active() { return active; }, get waiting() { return queue.length; } };
}
