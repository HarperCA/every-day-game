// 美国比赛库的结构：按顺序执行全部结构文件建出来的库，和按描述生成的一致；打开时建好全部表。
// 2026-11-03 起线上有真实数据：001 不再改，改表一律新增编号文件（002 起）。所以不再比 001 的文字，改成比“全部文件执行完的表”和“描述生成的表”。
import { describe, expect, test } from 'vitest';
import { RAW } from '../../../../../共用/db/index.mjs';
import { openSqlite } from '../../../../../共用/工具/sqlite.mjs';
import { openDb, TABLES } from '../../../index.mjs';
import { buildUsSql } from '../../生成.mjs';

// 一个库里每张表的列（按名字排，ALTER TABLE 加的列在最后，顺序不比）和索引
function 结构(sqlite) {
  const 表们 = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('schema_version') AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);
  return Object.fromEntries(表们.map(表 => [表, {
    列: sqlite.prepare(`PRAGMA table_info(${表})`).all().map(c => `${c.name} ${c.type}${c.notnull ? ' NOT NULL' : ''}${c.dflt_value != null ? ` DEFAULT ${c.dflt_value}` : ''}${c.pk ? ' PK' : ''}`).sort(),
    索引: sqlite.prepare(`PRAGMA index_list(${表})`).all().filter(i => i.origin === 'c').map(i => `${i.name}${i.unique ? ' UNIQUE' : ''}`).sort(),
  }]));
}

describe('建库', () => {
  test('按顺序执行全部结构文件，建出来的表和按描述生成的一致（描述改了要新增编号文件）', () => {
    const 按文件 = openDb({ file: ':memory:' })[RAW];
    const 按描述 = openSqlite(':memory:');
    按描述.exec(buildUsSql());
    expect(结构(按文件)).toEqual(结构(按描述));
  });
  test('打开时建好美国的全部表，没有北京的表', () => {
    const db = openDb({ file: ':memory:' });
    for (const name of Object.keys(TABLES)) expect(db.count(name), name).toBe(0);
    expect(() => db.count('favorite')).toThrow('没有这张表');
  });
  test('002：届次有“下一届预计”（每日归档时算出来存进去，2026-11-03）', () => {
    const db = openDb({ file: ':memory:' });
    expect(db[RAW].prepare('PRAGMA table_info(edition)').all().map(c => c.name)).toContain('next_edition_estimate');
  });
  test('003：搜索记忆表，每个比赛一份 Markdown（新维护用，2026-11-07）', () => {
    const db = openDb({ file: ':memory:' });
    expect(db[RAW].prepare('PRAGMA table_info(search_memory)').all().map(c => c.name).sort()).toEqual(['content', 'created_at', 'id', 'updated_at', 'updated_by', 'version']);
    expect(db[RAW].prepare('PRAGMA foreign_key_list(search_memory)').all().map(k => `${k.from}→${k.table}.${k.to}`)).toEqual(['id→competition.id']);
  });
  test('004：爬虫脚本表、指纹记录表，每个比赛一行（新维护用，2026-11-08）', () => {
    const db = openDb({ file: ':memory:' });
    const 列 = 表 => db[RAW].prepare(`PRAGMA table_info(${表})`).all().map(c => c.name).sort();
    expect(列('crawl_script')).toEqual(['created_at', 'fail_count', 'id', 'last_error', 'last_ok_at', 'list_url', 'needs_browser', 'prompt_version', 'steps', 'updated_at', 'updated_by', 'version', 'written_by']);
    expect(列('page_fingerprint')).toEqual(['changed_at', 'checked_at', 'created_at', 'etag', 'hash', 'id', 'items', 'last_modified', 'list_url', 'updated_at', 'version']);
    for (const 表 of ['crawl_script', 'page_fingerprint']) expect(db[RAW].prepare(`PRAGMA foreign_key_list(${表})`).all().map(k => `${k.from}→${k.table}.${k.to}`)).toEqual(['id→competition.id']);
  });
});
