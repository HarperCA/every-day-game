// 描述：每张表的字段写得对不对，旧记录的每个字段都有去处。
import { describe, expect, test } from 'vitest';
import { FIELD_TYPES, TABLES } from '../../index.mjs';

describe('描述', () => {
  const tables = Object.values(TABLES);
  test('有两级：比赛和届次，届次挂在比赛下', () => {
    expect(TABLES.competition).toBeTruthy();
    expect(TABLES.edition.字段.competition_id.指向).toBe('competition');
  });
  for (const table of tables) {
    test(`${table.表名}：每个字段都写了说明、必填、类型，类型都认识，指向的表都在`, () => {
      expect(table.字段[table.主键], '主键要在字段里').toBeTruthy();
      for (const [name, field] of Object.entries(table.字段)) {
        expect(typeof field.说明, `${name}.说明`).toBe('string');
        expect(typeof field.必填, `${name}.必填`).toBe('boolean');
        expect(Object.keys(FIELD_TYPES), `${name}.类型`).toContain(field.类型);
        if (field.指向) expect(Object.keys(TABLES), `${name}.指向`).toContain(field.指向);
      }
      for (const cols of [...(table.索引 || []), ...(table.唯一 || [])]) {
        for (const col of cols) expect(Object.keys(table.字段), `索引里的 ${col}`).toContain(col);
      }
    });
  }
  test('可选值是列表或还没定（null）；默认值在可选值里；最长是数字', () => {
    for (const table of tables) {
      for (const [name, field] of Object.entries(table.字段)) {
        const at = `${table.表名}.${name}`;
        if ('可选值' in field) expect(field.可选值 === null || Array.isArray(field.可选值), at).toBe(true);
        if ('默认' in field && Array.isArray(field.可选值)) expect(field.可选值, `${at} 的默认值`).toContain(field.默认);
        if (field.最长 != null) expect(Number.isInteger(field.最长) && field.最长 > 0, `${at}.最长`).toBe(true);
      }
    }
  });
  test('旧记录的每个字段都有去处：搬到某个字段，或写明为什么不搬', async () => {
    const { OLD_FIELDS, NOT_MOVED } = await import('../../../建库/旧字段.mjs');
    const mapped = new Set(['sources']);   // sources 整个拆成 source 表
    for (const table of tables) {
      for (const field of Object.values(table.字段)) {
        for (const old of String(field.旧 || '').split('/').map(s => s.trim()).filter(Boolean)) mapped.add(old);
      }
    }
    expect(OLD_FIELDS.filter(old => !mapped.has(old) && !NOT_MOVED[old])).toEqual([]);
  });
  test('被指向的表排在前面（按这个顺序建表）', () => {
    const order = Object.keys(TABLES);
    for (const table of tables) {
      for (const field of Object.values(table.字段)) {
        if (field.指向 && field.指向 !== table.表名) expect(order.indexOf(field.指向)).toBeLessThan(order.indexOf(table.表名));
      }
    }
  });
});

// 2026-10-31 用户定：状态只有三种并附理由；删除先打标记，30 天后真删；人工改过的字段机器不再自动改
describe('状态、删除、人工', () => {
  const E = TABLES.edition.字段;
  const C = TABLES.competition.字段;
  test('届次状态只有 已发布、已归档、待人工审核，附理由和状态时间', () => {
    expect(E.status.可选值).toEqual(['已发布', '已归档', '待人工审核']);
    expect(E.status.必填).toBe(true);
    expect(E.status_reason.类型).toBe('列表');
    expect(E.status_at.类型).toBe('时间');
    expect(E.last_verified_at).toBeTruthy();
  });
  // 下一届预计 2026-11-03 加回来了（结构/002）：用户定每日归档时算出来存进届次，同步给小程序
  test('旧的审核字段都去掉了：校验、人工审核、归档时间和原因、发布时间、替代关系……', () => {
    const gone = ['data_status', 'system_validation', 'system_review_issues', 'system_reviewed_at', 'manual_review', 'needs_manual_review',
      'manual_review_override', 'manual_review_reason', 'manual_reviewed_at', 'manual_reviewed_by', 'quality_issues', 'superseded_by',
      'archived_at', 'archived_reason', 'published_at', 'first_seen_at', 'admission_verdict', 'curation_import'];
    expect(gone.filter(name => name in E)).toEqual([]);
    expect('status' in C).toBe(false);   // 比赛删没删看 deleted_at，不再另设状态
  });
  test('比赛和届次都能标删除：删除标记是 deleted_at，记下谁删的；不再有“不真删”', () => {
    for (const table of [TABLES.competition, TABLES.edition]) {
      expect(table.删除标记).toBe('deleted_at');
      expect(table.字段.deleted_at.类型).toBe('时间');
      expect(table.字段.deleted_by).toBeTruthy();
      expect(table.不真删).toBeUndefined();
    }
  });
  test('比赛和届次都记下人工改过哪些字段', () => {
    expect(C.manual_fields.类型).toBe('列表');
    expect(E.manual_fields.类型).toBe('列表');
  });
  test('不收录名单：删除时勾了“以后不再收录”的比赛记在这里', () => {
    const B = TABLES.blocked_competition;
    expect(B).toBeTruthy();
    expect(Object.keys(B.字段)).toEqual(expect.arrayContaining(['id', 'name', 'website', 'competition_id', 'reason', 'created_at', 'created_by']));
  });
  test('比赛记下上次维护时间：维护每次挑 7 天内没维护过、上次最早的比赛（2026-11-01 用户定）', () => {
    expect(TABLES.competition.字段.last_maintained_at).toMatchObject({ 必填: false, 类型: '时间' });
    expect(TABLES.competition.索引).toContainEqual(['last_maintained_at']);
  });
  test('拒过的网址：寻找流程筛选、审核拒掉的候选记 30 天，对比去重时跳过', () => {
    const R = TABLES.rejected_url;
    expect(R).toBeTruthy();
    expect(Object.keys(R.字段)).toEqual(['id', 'url', 'url_key', 'title', 'reason', 'module', 'run_id', 'rejected_at']);
    for (const name of ['id', 'url', 'url_key', 'reason', 'module', 'rejected_at']) expect(R.字段[name].必填, name).toBe(true);
    expect(R.索引).toEqual([['url_key'], ['rejected_at']]);
  });
});
