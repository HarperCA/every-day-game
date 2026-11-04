// 测试用：模块直接调用 run(input, ctx) 时用的假 ctx。不连网、不调 AI、不碰数据库。
export function fakeCtx({ signal, view = () => null, list = () => [], now = '2026-10-29T12:00:00.000Z' } = {}) {
  const stored = [];
  return {
    log: { info() {}, warn() {}, error() {} },
    signal: signal || new AbortController().signal,
    now: () => new Date(now),
    blobs: { put: text => { stored.push(text); return `hash-${stored.length}`; }, get: () => null },
    view,
    list,
    stored,
  };
}
