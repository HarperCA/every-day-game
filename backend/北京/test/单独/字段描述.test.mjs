// 北京两个库的描述：字段写得对不对；“指向”的表在同一个库里，跨库的“对应”都能在美国比赛库里找到那张表。
import { describe, expect, test } from 'vitest';
import { FIELD_TYPES, TABLES as US_TABLES } from '../../../美国/db/index.mjs';
import { TABLES as 主 } from '../../主数据库/index.mjs';
import { TABLES as 副 } from '../../副数据库/index.mjs';

describe('两个库各管各的表', () => {
  test('主数据库只有公开副本；副数据库是用户和挂在用户下的五张表', () => {
    expect(Object.keys(主)).toEqual(['public_competition', 'public_edition']);
    expect(Object.keys(副).slice(0, 6)).toEqual(['user_account', 'favorite', 'reminder', 'general_feedback', 'feedback', 'user_preference']);
    // 上线后新增的表排在后面：组队（2026-11-08，002-组队.sql）
    expect(Object.keys(副)).toEqual(expect.arrayContaining(['team', 'team_member', 'team_application']));
    // 校赛（2026-11-08，003-校赛.sql）：和美国审核的接口，挂用户的字段叫 user（申请、学生）或 admin（邀请、校赛）
    expect(Object.keys(副)).toEqual(expect.arrayContaining(['school_admin', 'school_member', 'school_invite', 'school_contest']));
    const 校赛挂用户 = { school_admin: 'user', school_member: 'user', school_invite: 'admin', school_contest: 'admin' };
    for (const 表 of Object.values(副)) if (表.表名 !== 'user_account') expect(表.字段[校赛挂用户[表.表名] || 'user_id']?.指向, 表.表名).toBe('user_account');
  });
  test('收藏挂比赛，提醒、纠错挂届次；比赛、届次在别的库，所以写“对应”，数据库不查', () => {
    expect(副.favorite.字段.competition_id).toMatchObject({ 对应: 'competition' });
    expect(副.favorite.字段.competition_id.指向).toBeUndefined();
    expect(副.reminder.字段.edition_id).toMatchObject({ 对应: 'edition' });
    expect(副.feedback.字段.edition_id).toMatchObject({ 对应: 'edition' });
  });
  test('公开副本：届次挂在公开比赛下，编号和美国一致', () => {
    expect(主.public_edition.字段.competition_id.指向).toBe('public_competition');
    expect(主.public_competition.字段.id.对应).toBe('competition');
  });
});

for (const [库名, TABLES] of [['主数据库', 主], ['副数据库', 副]]) {
  describe(`${库名}的描述`, () => {
    for (const table of Object.values(TABLES)) {
      test(`${table.表名}：字段都写了说明、必填、类型；指向的表在同一个库，对应的表在美国`, () => {
        expect(table.字段[table.主键], '主键要在字段里').toBeTruthy();
        for (const [name, field] of Object.entries(table.字段)) {
          expect(typeof field.说明, `${name}.说明`).toBe('string');
          expect(typeof field.必填, `${name}.必填`).toBe('boolean');
          expect(Object.keys(FIELD_TYPES), `${name}.类型`).toContain(field.类型);
          if (field.指向) expect(Object.keys(TABLES), `${name}.指向`).toContain(field.指向);
          if (field.对应) expect(Object.keys(US_TABLES), `${name}.对应`).toContain(field.对应);
          if ('默认' in field && Array.isArray(field.可选值)) expect(field.可选值, `${name} 的默认值`).toContain(field.默认);
        }
        for (const cols of [...(table.索引 || []), ...(table.唯一 || [])]) {
          for (const col of cols) expect(Object.keys(table.字段), `索引里的 ${col}`).toContain(col);
        }
      });
    }
  });
}

describe('公开副本和美国比赛库对得上', () => {
  const P = 主.public_edition.字段;
  const E = US_TABLES.edition.字段;
  test('公开状态只有已发布、已归档（美国的待人工审核不公开），写法和美国一样', () => {
    expect(P.status.可选值).toEqual(['已发布', '已归档']);
    expect(P.status.可选值.every(v => E.status.可选值.includes(v))).toBe(true);
  });
  test('报名时间的类型和美国一样（原文只写日期的只存日期，同步过来不能被拒）', () => {
    expect(P.registration_start.类型).toBe(E.registration_start.类型);
    expect(P.registration_end.类型).toBe(E.registration_end.类型);
  });
});
