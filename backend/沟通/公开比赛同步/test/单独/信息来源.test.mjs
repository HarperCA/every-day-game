// 公开比赛同步 · 信息来源（2026-11-12，和北京约定的字段名）：推给北京的届次 data 里多 info_source、info_source_url。
//   info_source：'official'（有官方、核验有效的来源，或旧数据什么来源都没有，默认）或 'school_repost'（只有高校转发来源）；
//   info_source_url：高校转发时是转发页网址（有好几条取核对时间最新的，一样就取排在后面的），official 时不带。
// 美国比赛库不另存这个字段，从来源表推出来：以后新维护找到官方通知、补上官方来源，下次推送自动变回 official。
import { describe, expect, test } from 'vitest';
import { open, seed } from '../../../../美国/db/test/复用/样例数据.mjs';
import { 整理届次 } from '../../格式.mjs';
import { 公开内容 } from '../../美国端.mjs';

const 届 = { id: 'e1', competition_id: 'c1', version: 1, edition_name: '第十九届', status: '已发布' };
const 源 = (id, url, 改 = {}) => ({ id, url, source_type: 'organizer_notice', is_official: true, validity_status: 'valid', ...改 });
const 转发 = (id, url, 改 = {}) => 源(id, url, { source_type: 'school_repost', is_official: false, ...改 });

describe('整理届次 · 信息来源', () => {
  test('只有高校转发来源：school_repost，带转发页网址；转发来源不进 sources（sources 只给官方的）', () => {
    const 回 = 整理届次(届, [转发('source-e1-1', 'https://jwc.a.edu.cn/1.htm'), 转发('source-e1-2', 'https://jwc.b.edu.cn/2.htm')]);
    expect(回.data).toMatchObject({ info_source: 'school_repost', info_source_url: 'https://jwc.b.edu.cn/2.htm' });
    expect(回.data.sources).toBeUndefined();
  });
  test('有官方有效来源：official，不带 info_source_url', () => {
    const 回 = 整理届次(届, [转发('s1', 'https://jwc.a.edu.cn/1.htm'), 源('s2', 'https://org.cn/n')]);
    expect(回.data.info_source).toBe('official');
    expect(回.data).not.toHaveProperty('info_source_url');
    expect(回.data.sources).toEqual([{ id: 's2', source_type: 'organizer_notice', url: 'https://org.cn/n' }]);
  });
  test('无效的转发来源不算；什么来源都没有（旧数据）：official', () => {
    expect(整理届次(届, [转发('s1', 'https://jwc.a.edu.cn/1.htm', { validity_status: 'invalid' })]).data.info_source).toBe('official');
    expect(整理届次(届, []).data.info_source).toBe('official');
  });
});

test('美国端读库：高校转发来源（不算官方）也读出来交给整理届次', () => {
  const db = open(); seed(db);
  db.insert('source', 'source-art-1', { edition_id: 'ed-math-2026', url: 'https://jwc.a.edu.cn/1.htm', source_type: 'school_repost', is_official: false, validity_status: 'valid' });
  const 届次 = 公开内容(db).届次们.find(e => e.id === 'ed-math-2026');
  expect(届次.data).toMatchObject({ info_source: 'school_repost', info_source_url: 'https://jwc.a.edu.cn/1.htm' });
});
