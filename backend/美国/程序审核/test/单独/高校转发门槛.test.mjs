// 发布门槛 · 高校转发（2026-11-12 用户定）：发现新一届就发布，追不到官方通知的用高校转发发布、标明来源。
// 发布门槛里“没有核验过的官方来源”“没有报名网址”两条对高校转发来源（source_type school_repost，有效、不算官方）的届次放行；
// 信息来源(记录) 标明这一届的信息出自官方（official）还是高校转发（school_repost）。
import { describe, expect, test } from 'vitest';
import { 查发布, 信息来源, 有核验过的官方来源, 报名网址顶上 } from '../../发布门槛/index.mjs';

const 基本 = { name: '中国大学生计算机设计大赛', id: 'e-2026', organizer: '教育部计算机类教指委', participants: '全国普通高校在校本科生', eligibility: '在校本科生',
  format_and_rules: '计算机设计作品评审', professions: ['计算机类'], registration_start: null, registration_end: null, pending_announcement: true, registration_url: null };
const 转发源 = { id: 's1', edition_id: 'e-2026', url: 'https://jwc.abc.edu.cn/info/1.htm', source_type: 'school_repost', is_official: false, validity_status: 'valid',
  title: '关于组织参加第十九届中国大学生计算机设计大赛的通知', content_summary: '高校转发', evidence_excerpt: '第十九届中国大学生计算机设计大赛', review_reason: '找新一届：高校转发',
  supports_fields: ['name'], last_verified_at: '2026-11-12T04:00:00.000Z' };
const 官方源 = { ...转发源, id: 's2', url: 'https://jsjds.blcu.edu.cn/n.html', source_type: 'organizer_notice', is_official: true };

describe('高校转发来源的届次', () => {
  test('没有官方来源、没有报名网址也放行', () => {
    expect(查发布({ ...基本, sources: [转发源] })).toEqual({ 结果: '通过', 原因们: [] });
    expect(有核验过的官方来源({ ...基本, sources: [转发源] })).toBe(false);
  });
  test('转发来源无效或不是网址：照旧拦', () => {
    const r = 查发布({ ...基本, sources: [{ ...转发源, validity_status: 'invalid' }] });
    expect(r.原因们).toEqual(['没有报名网址', '没有核验过的官方来源']);
    expect(查发布({ ...基本, sources: [{ ...转发源, url: 'ftp://x' }] }).结果).toBe('不通过');
  });
  test('标题、范围、报名时间照查（高校转发只放行来源和报名网址两条）', () => {
    const r = 查发布({ ...基本, pending_announcement: false, sources: [转发源] });
    expect(r.原因们).toEqual(['报名起止时间均缺失，请核实或说明尚未公布']);
  });
  test('报名网址顶上不拿转发页（只拿核验过的官方来源）', () => {
    expect(报名网址顶上({ ...基本, sources: [转发源] })).toBe('');
  });
});

test('信息来源：有核验过的官方来源是 official；只有高校转发是 school_repost；都没有给 null', () => {
  expect(信息来源({ ...基本, sources: [转发源, 官方源] })).toBe('official');
  expect(信息来源({ ...基本, sources: [转发源] })).toBe('school_repost');
  expect(信息来源({ ...基本, sources: [] })).toBe(null);
});
