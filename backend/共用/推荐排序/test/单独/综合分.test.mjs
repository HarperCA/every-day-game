// 综合分（《第一步：排序规则》第 ⑥ 条：截止日相同或都没有截止日时，综合分越高越靠前）。
// 期望值是 2026-11-01 用旧代码（publicData/competitionRanking.js 的 rankRecords、relevance）在同样输入下算出来的：
// 旧系统发布时会先算好 value_scores、timing_reliability 存进公开缓存，这里改成用新比赛库的字段当场算，结果必须一样。
import { describe, expect, test } from 'vitest';
import { 综合分, 综合分排名 } from '../../index.mjs';

const now = new Date('2026-11-01T04:00:00Z');
const 样例 = [
  {
    "id": "e-math",
    "name": "全国大学生数学建模竞赛",
    "professions": [
      "数学与统计",
      "计算机与AI"
    ],
    "objective_tags": [
      "建模"
    ],
    "recognition": [
      {
        "path": "保研考研",
        "level": "高",
        "evidence": "多校保研加分",
        "scope": []
      }
    ],
    "recommendation": "强烈推荐",
    "registration_start": "2026-10-01",
    "registration_end": "2026-11-10",
    "registration_organization": "学校统一报名",
    "scale_tier": "10万以上",
    "fee_type": "收费",
    "participants": "本科生",
    "eligibility": "在校生",
    "format_and_rules": "三天",
    "team_size": "3人",
    "registration_method": "学校",
    "fees": "有",
    "rewards": "奖状",
    "participant_scale": "很多",
    "lifecycle": "长期举办"
  },
  {
    "id": "e-new",
    "name": "首届智能体创新赛",
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
        "evidence": "企业主办",
        "scope": [
          "算法岗"
        ]
      }
    ],
    "reward_highlights": [
      "实习或直通面试",
      "现金奖金"
    ],
    "reward_amount": 120000,
    "reward_tier": "10万-50万",
    "recommendation": "值得参加",
    "registration_start": "2026-10-25",
    "registration_end": "2026-11-05",
    "registration_organization": "自行报名",
    "scale_tier": "千人以下",
    "fee_type": "免费",
    "lifecycle": "首届"
  },
  {
    "id": "e-art",
    "name": "大学生设计大赛",
    "professions": [
      "设计与艺术"
    ],
    "objective_tags": [
      "设计"
    ],
    "recommendation": "适合练手",
    "registration_start": "2026-09-01",
    "registration_end": "2026-12-31",
    "registration_organization": "自行报名",
    "scale_tier": "1万-10万",
    "fee_type": "免费",
    "lifecycle": "长期举办",
    "participants": "在校生"
  },
  {
    "id": "e-tbd",
    "name": "外语演讲比赛",
    "professions": [
      "外语与教育"
    ],
    "recommendation": "信息不足",
    "registration_organization": "暂未明确",
    "lifecycle": "暂未明确"
  },
  {
    "id": "e-soon",
    "name": "数据分析挑战赛",
    "professions": [
      "计算机与AI",
      "数学与统计"
    ],
    "objective_tags": [
      "数据"
    ],
    "recommendation": "高难挑战",
    "registration_start": "2026-11-08",
    "registration_end": "2026-12-08",
    "registration_organization": "两种方式均可",
    "reward_highlights": [
      "保研考研加分"
    ],
    "scale_tier": "千人-1万",
    "fee_type": "免费"
  },
  {
    "id": "e-closed",
    "name": "机械创新设计大赛",
    "professions": [
      "机械与自动化"
    ],
    "recommendation": "值得参加",
    "registration_start": "2026-08-01",
    "registration_end": "2026-10-15",
    "registration_organization": "需先校内选拔",
    "recognition": [
      {
        "path": "保研考研",
        "level": "中",
        "evidence": "教育部名单"
      }
    ],
    "competition_end": "2026-12-01"
  },
  {
    "id": "e-arch",
    "name": "往届商业挑战赛",
    "status": "已归档",
    "professions": [
      "经管与商科"
    ],
    "recommendation": "谨慎报名",
    "registration_start": "2025-09-01",
    "registration_end": "2025-10-01"
  },
  {
    "id": "e-cs2",
    "name": "程序设计天梯赛",
    "professions": [
      "计算机与AI"
    ],
    "objective_tags": [
      "算法"
    ],
    "recognition": [
      {
        "path": "求职就业",
        "level": "高",
        "evidence": "大厂认可"
      }
    ],
    "recommendation": "强烈推荐",
    "registration_start": "2026-10-20",
    "registration_end": "2026-11-30",
    "registration_organization": "自行报名",
    "scale_tier": "1万-10万",
    "fee_type": "收费",
    "lifecycle": "长期举办"
  }
];

describe('综合分（和旧代码同样输入同样结果）', () => {
  const 分数 = {"e-math": 0.726667, "e-new": 0.868444, "e-art": 0.421889, "e-tbd": 0.284, "e-soon": 0.484889, "e-closed": 0.381778, "e-arch": 0.180444, "e-cs2": 0.658111};
  test.each(Object.entries(分数))('%s', (id, expected) => {
    const item = 样例.find(entry => entry.id === id);
    expect(Number(综合分(item, {}, now).分数.toFixed(6))).toBe(expected);
  });
});

describe('推荐等级的两种写法', () => {
  test('比赛库里存的是对象（等级在 recommendation.recommendation），和旧缓存里直接写等级的算出一样的分', () => {
    const item = 样例.find(entry => entry.id === 'e-math');
    const 对象写法 = { ...item, recommendation: { recommendation: '强烈推荐', reasons: ['多校保研加分'] } };
    expect(综合分(对象写法, {}, now).分数).toBe(综合分(item, {}, now).分数);
    expect(综合分({ ...item, recommendation: { recommendation: '信息不足' } }, {}, now).各项.推荐等级).toBe(0.5);
  });
});

describe('综合分排名：加权打分后做多样性重排（和旧代码同样顺序）', () => {
  test('不带条件', () => expect(综合分排名(样例, {}, now).map(item => item.id)).toEqual(["e-new", "e-math", "e-cs2", "e-art", "e-closed", "e-soon", "e-tbd", "e-arch"]));
  test('用户偏好计算机与AI', () => expect(综合分排名(样例, { 用户专业: ['计算机与AI'] }, now).map(item => item.id)).toEqual(["e-new", "e-math", "e-cs2", "e-soon", "e-art", "e-closed", "e-tbd", "e-arch"]));
  test('目标求职就业、岗位算法岗（按岗位重算价值分）', () => expect(综合分排名(样例, { 目标路径: '求职就业', 目标岗位: '算法岗' }, now).map(item => item.id)).toEqual(["e-new", "e-cs2", "e-math", "e-art", "e-closed", "e-tbd", "e-soon", "e-arch"]));
  test('不改动传进来的列表和条目', () => {
    const copy = JSON.parse(JSON.stringify(样例));
    综合分排名(copy, {}, now);
    expect(copy).toEqual(样例);
  });
});
