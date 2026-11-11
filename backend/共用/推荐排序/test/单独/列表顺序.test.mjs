// 首页列表顺序（《第一步：排序规则》①–⑥）和搜索词对应的专业大类。
// 期望值是 2026-11-01 用旧代码（publicData/listOrder.js 的 buildPublicList + personalizePage、majorKeywords.js 的 majorCategories）
// 在同样输入下算出来的，只有一处按规则改了旧代码：搜索词对得上专业时，旧代码只按专业筛，名称里有这个词、专业不对的会漏掉；
// 规则 ① 写的是“名称命中的在前、只是专业对得上的在后”，所以名称命中的也留着（“搜设计”那两条）。
// 收藏按比赛编号、提醒按届次编号（收藏挂比赛、提醒挂届次）。
import { describe, expect, test } from 'vitest';
import { 专业大类, 排列表 } from '../../index.mjs';

const now = new Date('2026-11-01T04:00:00Z');
const 样例 = [
  {
    "id": "e-math",
    "competition_id": "c-math",
    "name": "全国大学生数学建模竞赛",
    "edition_name": "2026 年数学建模",
    "organizer": "中国工业与应用数学学会",
    "aliases": [
      "国赛数模"
    ],
    "professions": [
      "数学与统计",
      "计算机与AI"
    ],
    "objective_tags": [
      "建模"
    ],
    "recommendation": "强烈推荐",
    "registration_start": "2026-10-01",
    "registration_end": "2026-11-10",
    "registration_organization": "学校统一报名",
    "scale_tier": "10万以上",
    "fee_type": "收费",
    "level": "国家级",
    "region": ""
  },
  {
    "id": "e-ai",
    "competition_id": "c-ai",
    "name": "首届智能体创新赛",
    "edition_name": "首届",
    "professions": [
      "计算机与AI"
    ],
    "objective_tags": [
      "AI"
    ],
    "recognition": [
      {
        "path": "求职就业",
        "level": "中",
        "evidence": "企业主办"
      }
    ],
    "reward_highlights": [
      "实习或直通面试"
    ],
    "recommendation": "值得参加",
    "registration_start": "2026-10-25",
    "registration_end": "2026-11-10",
    "registration_organization": "自行报名",
    "fee_type": "免费",
    "lifecycle": "首届",
    "level": "国家级"
  },
  {
    "id": "e-cs",
    "competition_id": "c-cs",
    "name": "程序设计天梯赛",
    "edition_name": "第十一届",
    "professions": [
      "计算机与AI"
    ],
    "objective_tags": [
      "算法"
    ],
    "recommendation": "值得参加",
    "registration_start": "2026-10-20",
    "registration_end": "2026-11-30",
    "registration_organization": "自行报名",
    "level": "国家级"
  },
  {
    "id": "e-nodl",
    "competition_id": "c-nodl",
    "name": "大学生软件创新大赛",
    "edition_name": "2026",
    "professions": [
      "计算机与AI",
      "电子信息"
    ],
    "recommendation": "适合练手",
    "registration_start": "2026-10-01",
    "competition_start": "2026-12-20",
    "level": "国家级"
  },
  {
    "id": "e-art",
    "competition_id": "c-art",
    "name": "浙江省大学生设计大赛",
    "edition_name": "第九届",
    "professions": [
      "设计与艺术"
    ],
    "region": "浙江省",
    "recommendation": "适合练手",
    "registration_start": "2026-09-01",
    "registration_end": "2026-12-31",
    "registration_organization": "自行报名",
    "fee_type": "免费",
    "level": "省级/区域级"
  },
  {
    "id": "e-art-gd",
    "competition_id": "c-art-gd",
    "name": "广东省大学生设计大赛",
    "edition_name": "第三届",
    "professions": [
      "设计与艺术"
    ],
    "region": "广东省",
    "registration_start": "2026-09-01",
    "registration_end": "2026-11-20",
    "level": "省级/区域级"
  },
  {
    "id": "e-any",
    "competition_id": "c-any",
    "name": "大学生创新创业大赛",
    "edition_name": "2026",
    "professions": [
      "综合/不限专业"
    ],
    "recommendation": "值得参加",
    "registration_start": "2026-10-01",
    "registration_end": "2026-11-20",
    "level": "国家级"
  },
  {
    "id": "e-tbd",
    "competition_id": "c-tbd",
    "name": "外语演讲比赛",
    "edition_name": "2027",
    "professions": [
      "外语与教育"
    ],
    "level": "国家级"
  },
  {
    "id": "e-soon",
    "competition_id": "c-soon",
    "name": "数据分析挑战赛",
    "edition_name": "2026",
    "professions": [
      "计算机与AI",
      "数学与统计"
    ],
    "objective_tags": [
      "数据"
    ],
    "registration_start": "2026-11-08",
    "registration_end": "2026-12-08",
    "registration_organization": "两种方式均可",
    "level": "国家级"
  },
  {
    "id": "e-run1",
    "competition_id": "c-run1",
    "name": "机械创新设计大赛",
    "edition_name": "第十二届",
    "professions": [
      "机械与自动化"
    ],
    "recommendation": "值得参加",
    "registration_start": "2026-08-01",
    "registration_end": "2026-10-15",
    "competition_end": "2026-12-01",
    "level": "国家级"
  },
  {
    "id": "e-run2",
    "competition_id": "c-run2",
    "name": "电子设计竞赛",
    "edition_name": "2026",
    "professions": [
      "电子信息"
    ],
    "registration_start": "2026-08-01",
    "registration_end": "2026-10-25",
    "competition_end": "2026-11-15",
    "level": "国家级"
  },
  {
    "id": "e-done1",
    "competition_id": "c-done1",
    "name": "商业挑战赛",
    "edition_name": "2025",
    "status": "已归档",
    "professions": [
      "经管与商科"
    ],
    "registration_start": "2025-09-01",
    "registration_end": "2025-10-01",
    "level": "国家级"
  },
  {
    "id": "e-done2",
    "competition_id": "c-done2",
    "name": "计算机设计大赛",
    "edition_name": "2026",
    "professions": [
      "计算机与AI",
      "设计与艺术"
    ],
    "registration_start": "2026-03-01",
    "registration_end": "2026-04-30",
    "competition_end": "2026-08-01",
    "level": "国家级"
  },
  {
    "id": "e-math2",
    "competition_id": "c-math",
    "name": "全国大学生数学建模竞赛",
    "edition_name": "2025 年数学建模",
    "aliases": [
      "国赛数模"
    ],
    "professions": [
      "数学与统计",
      "计算机与AI"
    ],
    "status": "已归档",
    "registration_start": "2025-09-01",
    "registration_end": "2025-09-10",
    "competition_end": "2025-09-15",
    "level": "国家级"
  }
];

describe('排列表：① 搜索 ② 专业和省份 ③ 状态分组 ④ 收藏提醒分档 ⑤ 截止日 ⑥ 综合分', () => {
  const 情况们 = [
  ["默认", {}, [["e-ai", "报名中", 0], ["e-math", "报名中", 0], ["e-any", "报名中", 0], ["e-art-gd", "报名中", 0], ["e-cs", "报名中", 0], ["e-art", "报名中", 0], ["e-nodl", "报名中", 0], ["e-soon", "时间待公布", 0], ["e-tbd", "时间待公布", 0], ["e-run2", "比赛中", 0], ["e-run1", "比赛中", 0], ["e-done2", "比赛已结束", 0], ["e-done1", "比赛已结束", 0], ["e-math2", "比赛已结束", 0]], null],
  ["收藏提醒", {"收藏": ["c-cs", "c-art", "c-run2"], "提醒": ["e-cs", "e-any", "e-done2"]}, [["e-cs", "报名中", 0], ["e-art", "报名中", 0], ["e-any", "报名中", 0], ["e-ai", "报名中", 0], ["e-math", "报名中", 0], ["e-art-gd", "报名中", 0], ["e-nodl", "报名中", 0], ["e-soon", "时间待公布", 0], ["e-tbd", "时间待公布", 0], ["e-run2", "比赛中", 0], ["e-run1", "比赛中", 0], ["e-done2", "比赛已结束", 0], ["e-done1", "比赛已结束", 0], ["e-math2", "比赛已结束", 0]], null],
  ["搜计算机", {"关键词": "计算机"}, [["e-done2", "比赛已结束", 0], ["e-ai", "报名中", 1], ["e-math", "报名中", 1], ["e-any", "报名中", 1], ["e-cs", "报名中", 1], ["e-nodl", "报名中", 1], ["e-soon", "时间待公布", 1], ["e-math2", "比赛已结束", 1]], ["计算机与AI"]],
  ["搜计算机带收藏", {"关键词": "计算机", "收藏": ["c-soon"], "提醒": ["e-soon"]}, [["e-done2", "比赛已结束", 0], ["e-ai", "报名中", 1], ["e-math", "报名中", 1], ["e-any", "报名中", 1], ["e-cs", "报名中", 1], ["e-nodl", "报名中", 1], ["e-soon", "时间待公布", 1], ["e-math2", "比赛已结束", 1]], ["计算机与AI"]],
  ["搜国赛数模", {"关键词": "国赛数模"}, [["e-math", "报名中", 0], ["e-math2", "比赛已结束", 0]], []],
  ["搜设计", {"关键词": "设计"}, [["e-art-gd", "报名中", 0], ["e-cs", "报名中", 0], ["e-art", "报名中", 0], ["e-run2", "比赛中", 0], ["e-run1", "比赛中", 0], ["e-done2", "比赛已结束", 0], ["e-any", "报名中", 1]], ["设计与艺术"]],
  ["搜设计带收藏", {"关键词": "设计", "收藏": ["c-art", "c-any"], "提醒": ["e-cs", "e-done2"]}, [["e-art", "报名中", 0], ["e-cs", "报名中", 0], ["e-art-gd", "报名中", 0], ["e-run2", "比赛中", 0], ["e-run1", "比赛中", 0], ["e-done2", "比赛已结束", 0], ["e-any", "报名中", 1]], ["设计与艺术"]],
  ["专业省份", {"专业们": ["设计与艺术"], "省份": "浙江省"}, [["e-any", "报名中", 0], ["e-art", "报名中", 0], ["e-done2", "比赛已结束", 0]], null],
  ["只报名中", {"列表分组": ["报名中"]}, [["e-ai", "报名中", 0], ["e-math", "报名中", 0], ["e-any", "报名中", 0], ["e-art-gd", "报名中", 0], ["e-cs", "报名中", 0], ["e-art", "报名中", 0], ["e-nodl", "报名中", 0]], null],
  ["已截止", {"列表分组": ["比赛中", "比赛已结束"]}, [["e-run2", "比赛中", 0], ["e-run1", "比赛中", 0], ["e-done2", "比赛已结束", 0], ["e-done1", "比赛已结束", 0], ["e-math2", "比赛已结束", 0]], null],
  ["偏好计算机", {"用户专业": ["计算机与AI"], "专业们": ["计算机与AI"]}, [["e-ai", "报名中", 0], ["e-math", "报名中", 0], ["e-any", "报名中", 0], ["e-cs", "报名中", 0], ["e-nodl", "报名中", 0], ["e-soon", "时间待公布", 0], ["e-done2", "比赛已结束", 0], ["e-math2", "比赛已结束", 0]], null],
  ];
  test.each(情况们)('%s', (_名, 条件, 顺序, 搜到的专业) => {
    const 回 = 排列表(样例, 条件, now);
    expect(回.条目们.map(条 => [条.id, 条.列表分组, 条.搜索块])).toEqual(顺序);
    expect(回.搜到的专业).toEqual(搜到的专业);
  });
  test('不改动传进来的列表和条目', () => {
    const 副本 = JSON.parse(JSON.stringify(样例));
    排列表(副本, { 关键词: '设计', 收藏: ['c-art'] }, now);
    expect(副本).toEqual(样例);
  });
});

describe('专业大类：搜索词像专业名时对应到十三类', () => {
  test.each([
    ["计算机", ["计算机与AI"]],
    ["土木工程专业", ["建筑与土木"]],
    ["设计", ["设计与艺术"]],
    ["临床医学", ["生物与医药"]],
    ["数学建模大赛", []],
    ["法", []],
    ["不限", ["综合/不限专业"]],
    ["080901", ["计算机与AI"]],
    ["经济统计学", ["经管与商科", "数学与统计"]],
    ["程序设计", ["计算机与AI"]],
    ["我想找计算机", ["计算机与AI"]],
    ["AI", ["计算机与AI"]],
  ])('%s', (词, 大类) => expect(专业大类(词)).toEqual(大类));
});
