import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { filterPublicRecords } = require('../apps/miniprogram/cloudfunctions/publicData/publicQuery.js');
const fixture = (id, profession) => ({
  id, name: `测试赛事${id}`, search_text: `测试赛事${id}`, professions: [profession],
  data_status: 'published', system_validation: 'passed', manual_review: 'passed',
  event_level: '国家级', region: '全国', registration_start: '2026-01-01', registration_end: '2026-12-31',
});
const records = [fixture('cs', '计算机与AI'), fixture('medicine', '生物与医药'), fixture('civil', '建筑与土木')];
const now = new Date('2026-10-10T00:00:00Z');

describe('specific profession competition search', () => {
  it.each([['软件工程', 'cs'], ['临床医学', 'medicine'], ['土木工程', 'civil'], ['080902', 'cs']])(
    'finds mapped competitions for %s without requiring the profession in the contest name', (keyword, id) => {
      expect(filterPublicRecords(records, {keyword}, now).items.map(item => item.id)).toEqual([id]);
    },
  );
  it('continues to apply explicitly selected filters within the profession results', () => {
    expect(filterPublicRecords(records, {keyword: '软件工程', eventLevel: '省级/区域级'}, now).total).toBe(0);
  });
  it('does not bypass publication checks for matching professions', () => {
    const pending = {...records[0], manual_review: 'pending'};
    expect(filterPublicRecords([pending], {keyword: '软件工程'}, now).total).toBe(0);
  });
});
