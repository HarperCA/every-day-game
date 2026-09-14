import { describe, expect, it } from 'vitest';
import { collectChangedFields, fromDateTimeLocal, linesToList } from '../apps/admin/src/editorUtils';

describe('admin full editor utilities', () => {
  it('collects top-level and nested content changes', () => {
    const before = { name:'赛事A', schedule:{ registration_end:'2026-09-01' }, sources:[{ url:'https://old.example' }] };
    const after = { name:'赛事B', schedule:{ registration_end:'2026-10-01' }, sources:[{ url:'https://new.example' }] };
    expect(collectChangedFields(before, after)).toEqual(['name', 'schedule.registration_end', 'sources']);
  });

  it('does not report unchanged records', () => {
    const record = { name:'赛事A', tags:['国家级'] };
    expect(collectChangedFields(record, structuredClone(record))).toEqual([]);
  });

  it('normalizes list and date-time editor values', () => {
    expect(linesToList('计算机\n\n 电子信息 ')).toEqual(['计算机', '电子信息']);
    expect(fromDateTimeLocal('2026-09-01T12:30')).toBe('2026-09-01T12:30:00+08:00');
    expect(fromDateTimeLocal('')).toBeNull();
  });
});
