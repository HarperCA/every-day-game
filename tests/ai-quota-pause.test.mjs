// Kimi 额度用完时暂停 5 小时（adminData/aiQuotaPause.js）
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { isQuotaError, activePause, nextPause, PAUSE_MS } = require('../apps/miniprogram/cloudfunctions/adminData/aiQuotaPause.js');

describe('Kimi 额度用完时暂停', () => {
  it('认得出额度用完的报错，别的错误不算', () => {
    expect(isQuotaError("ai_provider_error:403:You've reached your 5-hour usage limit. Your quota will reset when the current 5-hour window ends.")).toBe(true);
    expect(isQuotaError('kimi_resolution_provider_error:403')).toBe(true);
    expect(isQuotaError('kimi_resolution_invalid_json')).toBe(false);
    expect(isQuotaError('ai_api_key_not_configured')).toBe(false);
  });
  it('满 5 小时才恢复；连续用完时保留最早开始暂停的时间', () => {
    const now = new Date('2026-10-09T09:40:00Z');
    const pause = nextPause('usage limit', now);
    expect(PAUSE_MS).toBe(5 * 3600000);
    expect(pause.pausedUntil).toBe('2026-10-09T14:40:00.000Z');
    expect(activePause(pause, new Date('2026-10-09T14:39:00Z'))).toBe(pause);
    expect(activePause(pause, new Date('2026-10-09T14:41:00Z'))).toBe(null);
    expect(nextPause('usage limit', new Date('2026-10-09T14:41:00Z'), pause).since).toBe(pause.since);
    expect(activePause({ pausedUntil:null })).toBe(null);
  });
});
