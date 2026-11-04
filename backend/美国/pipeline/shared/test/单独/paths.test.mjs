// 运行文件夹：按北京时间的日期命名，同一天加序号，只删超过 90 天的日期文件夹。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { beijingDate, nextRunFolder, removeExpiredRuns } from '../../paths.mjs';
import { tempRoot } from '../../../test/复用/假模块.mjs';

describe('运行文件夹', () => {
  test('按北京时间取日期：UTC 17:30 已经是北京的第二天', () => {
    expect(beijingDate(new Date('2026-10-28T17:30:00Z'))).toBe('2026-10-29');
    expect(beijingDate(new Date('2026-10-28T15:59:00Z'))).toBe('2026-10-28');
  });

  test('同一天依次是 日期、日期-02、日期-03', () => {
    const root = tempRoot();
    const now = new Date('2026-10-28T17:30:00Z');
    const first = nextRunFolder(root, now);
    expect(path.basename(first)).toBe('2026-10-29');
    fs.mkdirSync(first);
    const second = nextRunFolder(root, now);
    expect(path.basename(second)).toBe('2026-10-29-02');
    fs.mkdirSync(second);
    expect(path.basename(nextRunFolder(root, now))).toBe('2026-10-29-03');
  });

  test('只删超过 90 天的日期文件夹，别的东西不碰', () => {
    const root = tempRoot();
    for (const name of ['2026-07-01', '2026-07-01-02', '2026-08-15', '2026-10-28', '手动备份']) fs.mkdirSync(path.join(root, name));
    const removed = removeExpiredRuns(root, { now: new Date('2026-10-29T01:00:00Z'), keepDays: 90 });
    expect(removed.sort()).toEqual(['2026-07-01', '2026-07-01-02']);
    expect(fs.readdirSync(root).sort()).toEqual(['2026-08-15', '2026-10-28', '手动备份']);
  });
});
