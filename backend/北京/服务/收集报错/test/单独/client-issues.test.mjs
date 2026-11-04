// 旧测试 tests/client-issues.test.mjs 的“上海 clientLog 收到上报时的清洗”原样搬来（2026-11-02）。后台汇总、拉取游标两段属于美国的访问异常页，到时一起搬。
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { sanitizeEvents } = require('../../sanitize.js');

describe('上海 clientLog 收到上报时的清洗', () => {
  const at = '2026-10-01T03:00:00.000Z';
  it('只收认识的类型、只留白名单字段、逐个截断', () => {
    const [item, ...rest] = sanitizeEvents([
      { id:'abc123-xyz', kind:'load_failed', at, page:'pages/index/index', message:'x'.repeat(500), elapsedMs:12345.6, networkType:'4g', ip:'1.2.3.4', openid:'secret' },
      { kind:'hack' },
      null,
    ], at);
    expect(rest).toHaveLength(0);
    expect(item).toMatchObject({ kind:'load_failed', client_id:'abc123-xyz', page:'pages/index/index', elapsed_ms:12346, networkType:'4g', received_at:at });
    expect(item.message).toHaveLength(300);
    expect(item).not.toHaveProperty('ip');
    expect(item).not.toHaveProperty('openid');
  });
  it('一次最多 20 条', () => {
    expect(sanitizeEvents(Array.from({ length:30 }, () => ({ kind:'slow' })), at)).toHaveLength(20);
  });
});

