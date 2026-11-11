// 小数据库：当晚的 run.db 单独成组件，对外只给处理接口。写入结果时自带格式检查，格式不对一条都不写；
// 每条都记下经过，从中间重跑时能撤销。总控、各模块的结果接口都调这里，不自己碰 run.db。
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { checkModuleOutput, openRunDb } from '../../index.mjs';
import { item, tempRoot } from '../../../test/复用/假模块.mjs';

const 打开 = () => openRunDb(path.join(tempRoot(), 'run.db'), { runId: '2026-10-31' });
const check = output => () => checkModuleOutput(output, { module: '测试' });

describe('格式检查', () => {
  test('合格的结果通过', () => {
    expect(checkModuleOutput({ items: [item('a')], changes: [], problems: [] }, { module: '测试' }).items).toHaveLength(1);
  });
  test('编号重复', () => expect(check({ items: [item('a'), item('a')] })).toThrow('重复'));
  test('状态写错', () => expect(check({ items: [item('a', '完成了')] })).toThrow('不是'));
  test('data 不是对象', () => expect(check({ items: [{ key: 'a', kind: 'x', status: '进行中', data: 'oops' }] })).toThrow('data'));
  test('修改不带版本号', () => expect(check({ changes: [{ table: 'competition', key: 'a', op: 'update', payload: {} }] })).toThrow('baseVersion'));
  test('改动指向不存在的条目', () => expect(check({ changes: [{ table: 'competition', key: 'a', op: 'insert', payload: {}, itemKey: 'nope' }] })).toThrow('找不到'));
  test('表名不合法', () => expect(check({ changes: [{ table: 'drop table;', key: 'a', op: 'insert', payload: {} }] })).toThrow('表名'));
});

describe('写入结果', () => {
  test('检查合格才写：条目、经过、待写改动、模块状态一次写入，交回统计', () => {
    const rundb = 打开();
    const stats = rundb.写入结果('01-search', { items: [item('a'), item('b', '已丢弃', {}, { reason: '重复' })], changes: [{ table: 'competition', key: 'x', op: 'insert', payload: {}, itemKey: 'a' }], problems: ['百度额度用完'] });
    expect(stats).toEqual({ items: 2, byStatus: { 进行中: 1, 已丢弃: 1 }, changes: 1, problems: ['百度额度用完'] });
    expect(rundb.activeItems().map(i => i.key)).toEqual(['a']);
    expect(rundb.trailOf('b')[0]).toMatchObject({ module: '01-search', status: '已丢弃', reason: '重复' });
    expect(rundb.已写入('01-search')).toBe(true);
    expect(rundb.已写入('02-dedup')).toBe(false);
  });
  test('格式不对：抛错，一条都不写', () => {
    const rundb = 打开();
    expect(() => rundb.写入结果('01-search', { items: [item('a'), item('a')] })).toThrow('重复');
    expect(rundb.item('a')).toBeNull();
    expect(rundb.已写入('01-search')).toBe(false);
  });
  test('后面的模块的改动可以挂在前面模块写过的条目上', () => {
    const rundb = 打开();
    rundb.写入结果('01-search', { items: [item('a')] });
    expect(() => rundb.写入结果('06-ingest', { items: [], changes: [{ table: 'edition', key: 'e', op: 'insert', payload: {}, itemKey: 'a' }] })).not.toThrow();
  });
  test('创建当晚：记下运行信息（可以重复调用，不会清掉已有的东西）', () => {
    const rundb = 打开();
    rundb.写入结果('01-search', { items: [item('a')] });
    rundb.创建当晚({ 搜索词: 12 });
    rundb.创建当晚({ 搜索词: 15 });
    expect(rundb.meta('run_id')).toBe('2026-10-31');
    expect(JSON.parse(rundb.meta('当晚信息'))).toEqual({ 搜索词: 15 });
    expect(rundb.item('a')).not.toBeNull();
  });
});

describe('查找和删除', () => {
  const 放三条 = () => {
    const rundb = 打开();
    rundb.写入结果('01-search', { items: [item('a', '进行中', { url: 'https://a.cn' }), item('b'), { ...item('r'), kind: 'record' }] });
    return rundb;
  };
  test('查找：默认找进行中的，可以按种类、状态找', () => {
    const rundb = 放三条();
    expect(rundb.查找().map(i => i.key)).toEqual(['a', 'b', 'r']);
    expect(rundb.查找({ kind: 'candidate' }).map(i => i.key)).toEqual(['a', 'b']);
    expect(rundb.查找({ kind: 'candidate' })[0].data).toEqual({ url: 'https://a.cn' });
    expect(rundb.查找({ status: '已丢弃' })).toEqual([]);
  });
  test('删除：标成已丢弃并写明原因，条目留着，经过记在这个模块名下', () => {
    const rundb = 放三条();
    expect(rundb.删除('02-dedup', [{ key: 'a', 原因: '网址和库里一样' }])).toEqual({ 删除: 1 });
    expect(rundb.查找({ kind: 'candidate' }).map(i => i.key)).toEqual(['b']);
    expect(rundb.查找({ status: '已丢弃' })[0]).toMatchObject({ key: 'a', stage: '02-dedup', data: { url: 'https://a.cn' } });
    expect(rundb.trailOf('a').at(-1)).toMatchObject({ module: '02-dedup', status: '已丢弃', result: '已丢弃', reason: '网址和库里一样' });
  });
  test('删除一批里有一条找不到或不是进行中：抛错，一条都不删', () => {
    const rundb = 放三条();
    expect(() => rundb.删除('02-dedup', [{ key: 'a', 原因: 'x' }, { key: 'nope', 原因: 'x' }])).toThrow('nope');
    expect(rundb.item('a').status).toBe('进行中');
    rundb.删除('02-dedup', [{ key: 'b', 原因: 'x' }]);
    expect(() => rundb.删除('02-dedup', [{ key: 'b', 原因: '又删' }])).toThrow('不是进行中');
  });
  test('删除要写原因', () => {
    const rundb = 放三条();
    expect(() => rundb.删除('02-dedup', [{ key: 'a' }])).toThrow('原因');
  });
  test('标记线索：标成“线索”并写明原因，不再交给后面的模块，可以按状态找出来；撤销时恢复', () => {
    const rundb = 放三条();
    expect(rundb.标记线索('03-filter', [{ key: 'a', 原因: '只留线索：竞赛目录' }])).toEqual({ 线索: 1 });
    expect(rundb.查找({ kind: 'candidate' }).map(i => i.key)).toEqual(['b']);
    expect(rundb.查找({ status: '线索' })[0]).toMatchObject({ key: 'a', stage: '03-filter' });
    expect(rundb.trailOf('a').at(-1)).toMatchObject({ module: '03-filter', status: '线索', reason: '只留线索：竞赛目录' });
    expect(() => rundb.标记线索('03-filter', [{ key: 'a', 原因: '又标' }])).toThrow('不是进行中');
    rundb.clearModules(['03-filter']);
    expect(rundb.item('a').status).toBe('进行中');
  });
  test('“线索”也是交回结果时认的状态', () => {
    expect(() => checkModuleOutput({ items: [item('a', '线索', {}, { reason: '目录' })] }, { module: '测试' })).not.toThrow();
  });
  test('从中间重跑撤销这个模块时，删掉的条目恢复成进行中', () => {
    const rundb = 放三条();
    rundb.删除('02-dedup', [{ key: 'a', 原因: 'x' }]);
    rundb.clearModules(['02-dedup']);
    expect(rundb.item('a')).toMatchObject({ status: '进行中', stage: '01-search' });
  });
});
